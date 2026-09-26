/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A1 — the admin console opens for staff with two-step sign-in and nobody else; the staff
 * trail records what they do and is out of the application role's reach.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { appDb } from '@/db/client';
import { tenants, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { issueSession } from '@/server/core/auth/session';
import { apiConfig } from '@/server/core/http/api';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { staffLog, staffTrail, type StaffContext } from '@/server/modules/admin/access';
import { invoiceForStaffHandler, listInvoicesHandler, listPeopleHandler, listStoresHandler, listSubscriptionsHandler, overviewHandler, personActionHandler, plansHandler, updatePlanHandler, staffTrailHandler, storeActionHandler, whoamiHandler } from '@/server/modules/admin/http';

setLogLevel('error');
const APP = 'http://localhost:5173';

async function person(harness: TestDb, email: string, flags: { isStaff?: boolean; totpEnabled?: boolean; deletedAt?: Date } = {}) {
  const id = uuidv7();
  await harness.asAdmin(() => harness.db.insert(users).values({ id, email, passwordHash: 'x', fullName: email.split('@')[0], ...flags } as any));
  const issued = await issueSession({ userId: id, config: apiConfig() });
  return { id, token: issued.accessToken };
}

const get = (handler: (r: Request) => Promise<Response>, path: string, token?: string) =>
  handler(new Request(`${APP}${path}`, { headers: token ? { authorization: `Bearer ${token}` } : {} }));

test('only staff with two-step sign-in get in; everyone else is told the page does not exist', async () => {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const merchant = await person(harness, 'owner@example.test');
    const staffNo2fa = await person(harness, 'new-staff@tajribah.test', { isStaff: true });
    const staff = await person(harness, 'staff@tajribah.test', { isStaff: true, totpEnabled: true });
    const gone = await person(harness, 'left@tajribah.test', { isStaff: true, totpEnabled: true });

    for (const handler of [whoamiHandler, staffTrailHandler, overviewHandler, listStoresHandler, listPeopleHandler, plansHandler, listSubscriptionsHandler, listInvoicesHandler]) {
      assert.equal((await get(handler, '/api/admin/x')).status, 401, 'no session');
      const notStaff = await get(handler, '/api/admin/x', merchant.token);
      assert.equal(notStaff.status, 404, 'a merchant is not even told the console exists');
      assert.equal(((await notStaff.json()) as any).code, 'not_found');
      const no2fa = await get(handler, '/api/admin/x', staffNo2fa.token);
      assert.equal(no2fa.status, 403);
      assert.match(((await no2fa.json()) as any).detail, /two-step sign-in/);
      assert.equal((await get(handler, '/api/admin/x', staff.token)).status, 200);
    }
    // A4: the one write endpoint — same guard, plus same-origin.
    const act = (token: string | undefined, headers: Record<string, string> = {}) => storeActionHandler(new Request(`${APP}/api/admin/stores/${store.tenantId}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: JSON.stringify({ type: 'suspend', reason: 'access test' }),
    }));
    assert.equal((await act(undefined)).status, 401);
    assert.equal((await act(merchant.token)).status, 404, 'a merchant cannot act, nor learn the console exists');
    assert.equal((await act(staffNo2fa.token)).status, 403);
    assert.equal((await act(staff.token, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status, 403, 'cross-origin refused');
    assert.equal((await act(staff.token)).status, 204);
    const [after] = await harness.asAdmin(() => harness.db.select().from(tenants).where(eq(tenants.id, store.tenantId)));
    assert.equal(after!.status, 'suspended');

    // A5: acting on a person — the same guard; the answer says how many sessions ended.
    const actOn = (token: string | undefined, id: string, headers: Record<string, string> = {}) => personActionHandler(new Request(`${APP}/api/admin/users/${id}/actions`, {
      method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: JSON.stringify({ type: 'end_sessions', reason: 'access test' }),
    }));
    assert.equal((await actOn(undefined, merchant.id)).status, 401);
    assert.equal((await actOn(merchant.token, staff.id)).status, 404, 'a merchant cannot sign staff out');
    assert.equal((await actOn(staffNo2fa.token, merchant.id)).status, 403);
    assert.equal((await actOn(staff.token, merchant.id, { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status, 403, 'cross-origin refused');
    const ended = await actOn(staff.token, merchant.id);
    assert.equal(ended.status, 200);
    assert.deepEqual(await ended.json(), { sessionsEnded: 1 });
    assert.equal((await get(whoamiHandler, '/api/admin/whoami', merchant.token)).status, 401, 'the ended session is refused at once');

    // A6: changing a plan — the same guard.
    const patch = (token: string | undefined, code: string, headers: Record<string, string> = {}) => updatePlanHandler(new Request(`${APP}/api/admin/plans/${code}`, {
      method: 'PATCH', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers },
      body: JSON.stringify({ limits: { products: 25 }, reason: 'access test' }),
    }));
    const outsider = await person(harness, 'outsider@example.test');
    assert.equal((await patch(undefined, 'starter')).status, 401);
    assert.equal((await patch(outsider.token, 'starter')).status, 404, 'a merchant cannot change prices, nor learn the console exists');
    assert.equal((await patch(staffNo2fa.token, 'starter')).status, 403);
    assert.equal((await patch(staff.token, 'starter', { origin: 'https://evil.example', 'sec-fetch-site': 'cross-site' })).status, 403, 'cross-origin refused');
    assert.equal((await patch(staff.token, 'platinum')).status, 404, 'no such plan');
    const changed = await patch(staff.token, 'starter');
    assert.equal(changed.status, 200);
    assert.deepEqual(await changed.json(), { changed: ['limits.products'] });

    // A7: one invoice — a merchant is told nothing, staff get 404 for an unknown id.
    const shopper = await person(harness, 'another-owner@example.test');
    assert.equal((await get(invoiceForStaffHandler, `/api/admin/invoices/${uuidv7()}`, shopper.token)).status, 404);
    assert.equal(((await (await get(invoiceForStaffHandler, `/api/admin/invoices/${uuidv7()}`, staff.token)).json()) as any).code, 'not_found');
    const me = await (await get(whoamiHandler, '/api/admin/whoami', staff.token)).json() as any;
    assert.equal(me.email, 'staff@tajribah.test');

    // Staff status is a fact in the database, read on every request: taking it away works at once.
    await harness.asAdmin(() => harness.db.update(users).set({ isStaff: false }).where(eq(users.id, staff.id)));
    assert.equal((await get(whoamiHandler, '/api/admin/whoami', staff.token)).status, 404);
    await harness.asAdmin(() => harness.db.update(users).set({ deletedAt: new Date() }).where(eq(users.id, gone.id)));
    assert.equal((await get(whoamiHandler, '/api/admin/whoami', gone.token)).status, 404, 'a deleted account is out');
  } finally { await harness.close(); resetEnv(); }
});

test('the staff trail: written per action, newest first, filterable by store; the app role cannot touch it', async () => {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  const harness = await createTestDb();
  try {
    const { tenantId } = await seedTenant(harness, 'alpha');
    const staff = await person(harness, 'staff@tajribah.test', { isStaff: true, totpEnabled: true });
    const ctx: StaffContext = { userId: staff.id, email: 'staff@tajribah.test', fullName: 'staff', requestId: 'req-1' };
    await staffLog(ctx, { action: 'coupon.create', targetType: 'coupon', targetId: 'WELCOME20' });
    await staffLog(ctx, { action: 'trial.extend', targetType: 'store', targetId: tenantId, storeId: tenantId, reason: 'launch partner' });

    const all = await staffTrail();
    assert.deepEqual(all.map((r) => r.action), ['trial.extend', 'coupon.create']);
    assert.equal(all[0].staff, 'staff@tajribah.test');
    assert.equal(all[0].reason, 'launch partner');
    assert.deepEqual((await staffTrail({ storeId: tenantId })).map((r) => r.action), ['trial.extend']);

    const body = await (await get(staffTrailHandler, `/api/admin/audit?store=${tenantId}`, staff.token)).json() as any;
    assert.deepEqual(body.entries.map((r: any) => r.action), ['trial.extend']);

    const denied = (e: any) => { for (let x = e; x; x = x.cause) if (/permission denied/.test(String(x.message))) return true; return false; };
    await assert.rejects(() => appDb().execute(sql`select * from staff_audit`), denied, 'a merchant request cannot read it');
    await assert.rejects(() => appDb().execute(sql`delete from staff_audit`), denied, 'or erase it');
  } finally { await harness.close(); resetEnv(); }
});
