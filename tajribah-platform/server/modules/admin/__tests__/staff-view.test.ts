/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A4b — "view as the store", through the real handlers and a real session: the staff member
 * sees the store's own screens, can change nothing, the store's trail says staff looked, and
 * it ends — on Stop, at its time, when staff status goes, or on a store switch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, products, sessions, staffAudit, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { issueSession } from '@/server/core/auth/session';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { apiConfig } from '@/server/core/http/api';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { endStaffViewHandler, startStaffViewHandler } from '@/server/modules/admin/http';
import { meHandler, switchTenantHandler } from '@/server/modules/auth/http';
import { createProductHandler, listProductsHandler } from '@/server/modules/products/http';

setLogLevel('error');
const APP = 'http://localhost:5173';

async function staffMember(harness: TestDb, tenantId: string | null = null) {
  const id = uuidv7();
  await harness.asAdmin(() => harness.db.insert(users).values({ id, email: `staff-${id.slice(-6)}@tajribah.test`, passwordHash: 'x', fullName: 'Staff', isStaff: true, totpEnabled: true } as any));
  const issued = await issueSession({ userId: id, tenantId, config: apiConfig() });
  return { id, token: issued.accessToken, sessionId: issued.session.id };
}
const call = (handler: (r: Request) => Promise<Response>, path: string, token: string, body?: unknown) =>
  handler(new Request(`${APP}${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  }));
const start = (token: string, storeId: string, minutes = 30, reason = 'merchant reports a missing product') =>
  call(startStaffViewHandler, `/api/admin/stores/${storeId}/view`, token, { minutes, reason });
const me = async (token: string) => (await (await call(meHandler, '/api/auth/me', token)).json()) as any;

test('view as the store: its own screens, read-only, both trails, then Stop returns the session', async () => {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const own = await seedTenant(harness, 'bravo'); // the staff member's own store, to return to
    await harness.asAdmin(() => harness.db.insert(products).values({ tenantId: store.tenantId, name: 'Oud 12ml' } as any));
    const staff = await staffMember(harness, own.tenantId);
    await harness.asAdmin(() => harness.db.insert(tenantMemberships).values({ tenantId: own.tenantId, userId: staff.id, role: 'owner' } as any));

    assert.equal((await start(staff.token, store.tenantId, 3)).status, 422, 'at least 5 minutes');
    assert.equal((await start(staff.token, store.tenantId, 61)).status, 422, 'at most an hour');
    assert.equal((await start(staff.token, store.tenantId, 30, 'no')).status, 422, 'a reason');
    const started = await start(staff.token, store.tenantId, 30);
    assert.equal(started.status, 200);

    const who = await me(staff.token);
    assert.equal(who.currentTenantId, store.tenantId);
    assert.equal(who.staffView.storeId, store.tenantId);
    assert.ok(who.tenants.some((t: any) => t.id === store.tenantId && t.role === 'viewer'), 'the store is in the switcher while viewing');

    const list = await call(listProductsHandler, '/api/products', staff.token);
    assert.equal(list.status, 200);
    assert.deepEqual(((await list.json()) as any).rows.map((p: any) => p.name), ['Oud 12ml'], 'the store’s own data');
    const write = await call(createProductHandler, '/api/products', staff.token, { name: 'Should not exist' });
    assert.equal(write.status, 403);
    assert.match(((await write.json()) as any).detail, /read-only staff view/);
    assert.equal((await harness.asAdmin(() => harness.db.select().from(products).where(eq(products.tenantId, store.tenantId)))).length, 1, 'nothing written');

    const storeRows = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceType, 'staff_view')));
    assert.deepEqual(storeRows.map((r) => [r.tenantId, r.actorType, r.actorUserId, r.action]), [[store.tenantId, 'staff', staff.id, 'create']], 'the store sees staff looked');

    assert.equal((await call(endStaffViewHandler, '/api/admin/view/end', staff.token, {})).status, 204);
    const after = await me(staff.token);
    assert.deepEqual([after.currentTenantId, after.staffView], [own.tenantId, null], 'back to the store it came from');
    assert.equal((await call(listProductsHandler, '/api/products', staff.token)).status, 200, 'its own store, normally');
    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit));
    assert.deepEqual(trail.map((r) => [r.action, r.storeId, (r.detail as any)?.why ?? null]), [['store.view_start', store.tenantId, null], ['store.view_end', store.tenantId, 'stopped']]);
    assert.equal((await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceType, 'staff_view')))).length, 2);
  } finally { await harness.close(); resetEnv(); }
});

test('it ends on its own: at its time, when staff status goes, and on a store switch; merchants cannot start one', async () => {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const staff = await staffMember(harness);
    const expire = () => harness.asAdmin(() => harness.db.update(sessions).set({ impersonatingUntil: new Date(Date.now() - 1000) }).where(eq(sessions.id, staff.sessionId)));

    await start(staff.token, store.tenantId);
    await expire();
    const late = await call(listProductsHandler, '/api/products', staff.token);
    assert.equal(late.status, 403, 'the time has passed: nothing more is shown');
    assert.match(((await late.json()) as any).detail, /ended/);
    const back = await me(staff.token);
    assert.deepEqual([back.currentTenantId, back.staffView], [null, null], '/me ends it and returns the session');
    const why = await harness.asAdmin(() => harness.db.select().from(staffAudit).where(eq(staffAudit.action, 'store.view_end')));
    assert.deepEqual(why.map((r) => (r.detail as any).why), ['expired']);

    await start(staff.token, store.tenantId);
    await harness.asAdmin(() => harness.db.update(users).set({ isStaff: false }).where(eq(users.id, staff.id)));
    assert.equal((await call(listProductsHandler, '/api/products', staff.token)).status, 404, 'no longer staff: the store is not theirs to see');
    assert.equal((await me(staff.token)).staffView, null);
    await harness.asAdmin(() => harness.db.update(users).set({ isStaff: true }).where(eq(users.id, staff.id)));

    // Switching store (to one they belong to) ends the view too.
    const own = await seedTenant(harness, 'bravo');
    await harness.asAdmin(() => harness.db.insert(tenantMemberships).values({ tenantId: own.tenantId, userId: staff.id, role: 'owner' } as any));
    await start(staff.token, store.tenantId);
    const switched = await switchTenantHandler(new Request(`${APP}/api/auth/switch-tenant`, { method: 'POST', headers: { authorization: `Bearer ${staff.token}`, 'content-type': 'application/json' }, body: JSON.stringify({ tenantId: own.tenantId }) }));
    assert.equal(switched.status, 200);
    const [session] = await harness.asAdmin(() => harness.db.select().from(sessions).where(eq(sessions.id, staff.sessionId)));
    assert.deepEqual([session!.tenantId, session!.impersonatingUntil, session!.impersonationReturnTenantId], [own.tenantId, null, null]);

    const merchant = await issueSession({ userId: store.userId, tenantId: store.tenantId, config: apiConfig() });
    assert.equal((await start(merchant.accessToken, own.tenantId)).status, 404, 'a merchant cannot view another store');
  } finally { await harness.close(); resetEnv(); }
});
