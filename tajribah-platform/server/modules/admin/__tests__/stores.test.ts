/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A3 — staff find any store and see it as its merchant does, without changing anything.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { creditLedger, products, subscriptions, tenants } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { currentUsage } from '@/server/core/billing/entitlements';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, seededPlanId } from '@/server/testing/harness';
import { staffLog, type StaffContext } from '@/server/modules/admin/access';
import { listStores, storeDetail } from '@/server/modules/admin/stores';

setLogLevel('error');
const STAFF = (id: string): StaffContext => ({ userId: id, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'r' });

test('the list: newest first, search by name / Arabic name / address / id, status and plan filters, paging, no deleted stores', async () => {
  const harness = await createTestDb();
  try {
    const a = await seedTenant(harness, 'alpha');
    const b = await seedTenant(harness, 'bravo');
    const c = await seedTenant(harness, 'charlie');
    const d = await seedTenant(harness, 'delta');
    const set = (id: string, patch: any) => harness.asAdmin(() => harness.db.update(tenants).set(patch).where(eq(tenants.id, id)));
    await set(a.tenantId, { name: 'Oud House', nameAr: 'بيت العود', slug: 'oud-house', status: 'active' });
    await set(b.tenantId, { name: 'Gold 100%', status: 'trial' });
    await set(c.tenantId, { status: 'suspended' });
    await set(d.tenantId, { deletedAt: new Date() });
    const growth = await seededPlanId(harness, 'growth');
    await harness.asAdmin(() => harness.db.insert(subscriptions).values({ tenantId: a.tenantId, planId: growth, status: 'active', currentPeriodStart: new Date(), currentPeriodEnd: new Date() } as any));

    const all = await listStores();
    assert.deepEqual(all.stores.map((s) => s.id), [c.tenantId, b.tenantId, a.tenantId], 'newest first, the deleted one absent');
    assert.deepEqual((await listStores({ q: 'oud' })).stores.map((s) => s.id), [a.tenantId]);
    assert.deepEqual((await listStores({ q: 'العود' })).stores.map((s) => s.id), [a.tenantId], 'the Arabic name');
    assert.deepEqual((await listStores({ q: 'oud-house' })).stores.map((s) => s.id), [a.tenantId], 'the address');
    assert.deepEqual((await listStores({ q: b.tenantId })).stores.map((s) => s.id), [b.tenantId], 'the id');
    assert.deepEqual((await listStores({ q: '100%' })).stores.map((s) => s.id), [b.tenantId], '% is a character, not a wildcard');
    assert.deepEqual((await listStores({ q: '_' })).stores, [], '_ is a character too: no store has one in its name or address');
    assert.deepEqual((await listStores({ status: 'suspended' })).stores.map((s) => s.id), [c.tenantId]);
    assert.deepEqual((await listStores({ plan: 'growth' })).stores.map((s) => [s.id, s.plan, s.subscription]), [[a.tenantId, 'growth', 'active']]);
    assert.deepEqual((await listStores({ plan: 'starter' })).stores.map((s) => s.id), [c.tenantId, b.tenantId], 'no subscription = the Starter trial');

    const first = await listStores({ limit: 2 });
    assert.equal(first.stores.length, 2);
    const second = await listStores({ limit: 2, before: first.next! });
    assert.deepEqual(second.stores.map((s) => s.id), [a.tenantId]);
    assert.equal(second.next, null);
  } finally { await harness.close(); }
});

test('one store: the merchant’s own numbers, members, staff actions — for a suspended store too — and nothing written', async () => {
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    await harness.asAdmin(() => harness.db.insert(products).values([{ tenantId: store.tenantId, name: 'A' }, { tenantId: store.tenantId, name: 'B' }] as any));
    const merchant = await buildTenantContext({ actor: { userId: store.userId, email: store.email, isStaff: false }, tenantId: store.tenantId, requestId: 'r' });
    const staff = STAFF(store.userId);
    await staffLog(staff, { action: 'trial.extend', targetType: 'store', targetId: store.tenantId, storeId: store.tenantId, reason: 'test' });

    const detail = await storeDetail(staff, store.tenantId);
    assert.equal(detail.usage.products.used, await currentUsage(merchant, 'products'), 'the number the merchant sees');
    assert.deepEqual(detail.usage.products, { used: 2, limit: 20 });
    assert.equal(detail.members.length, 1);
    assert.deepEqual(detail.staffTrail.map((r) => r.action), ['trial.extend']);
    assert.equal(detail.credits.balance, 0);
    assert.equal((await harness.asAdmin(() => harness.db.select().from(creditLedger))).length, 0, 'inspecting made no credit grant');

    await harness.asAdmin(() => harness.db.update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, store.tenantId)));
    assert.equal((await storeDetail(staff, store.tenantId)).store.status, 'suspended', 'a suspended store can still be inspected');
    await assert.rejects(() => storeDetail(staff, uuidv7()), (e: any) => e.code === 'not_found');
  } finally { await harness.close(); }
});
