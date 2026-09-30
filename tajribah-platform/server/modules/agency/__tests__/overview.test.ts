/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T62 — agency accounts: the overview lists exactly the stores this person can open, each read
 * inside its own context (another store's data never mixes in), puts what needs a person first,
 * lists a suspended store without opening it, and a single sign-on session sees its own store only.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { edgeConfigs, products, storeConnections, tenantMemberships, tenants } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { storesOverview } from '@/server/modules/agency/service';

setLogLevel('error');

async function member(harness: TestDb, tenantId: string, userId: string, role: string) {
  await harness.asAdmin(() => harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId, userId, role, status: 'active' } as any));
}
async function product(harness: TestDb, tenantId: string, name: string, live = false) {
  const id = uuidv7();
  await harness.asAdmin(async () => {
    await harness.db.insert(products).values({ id, tenantId, name, status: 'active' } as any);
    if (live) await harness.db.insert(edgeConfigs).values({ id: uuidv7(), tenantId, productId: id, key: `k/${id}`, version: 1, publishedAt: new Date() } as any);
  });
}

test('an agency sees every client store it belongs to — and nothing of anyone else’s', async () => {
  const harness = await createTestDb();
  try {
    const now = new Date();
    const agency = await seedTenant(harness, 'agency', { plan: 'pro' }); // the agency's own store; its owner is the agency login
    const client = await seedTenant(harness, 'client', { plan: 'pro' });
    const ending = await seedTenant(harness, 'ending');
    const held = await seedTenant(harness, 'held', { plan: 'pro' });
    const later = await seedTenant(harness, 'later');
    const lapsed = await seedTenant(harness, 'lapsed');
    const stranger = await seedTenant(harness, 'stranger', { plan: 'pro' });
    await member(harness, client.tenantId, agency.userId, 'admin');
    await member(harness, ending.tenantId, agency.userId, 'editor');
    await member(harness, held.tenantId, agency.userId, 'viewer');
    await member(harness, later.tenantId, agency.userId, 'admin');
    await member(harness, lapsed.tenantId, agency.userId, 'admin');
    await harness.asAdmin(async () => {
      await harness.db.update(tenants).set({ status: 'trial', trialEndsAt: new Date(now.getTime() + 2 * 86_400_000) } as any).where(eq(tenants.id, ending.tenantId));
      await harness.db.update(tenants).set({ status: 'suspended' } as any).where(eq(tenants.id, held.tenantId));
      await harness.db.update(tenants).set({ status: 'trial', trialEndsAt: new Date(now.getTime() + 10 * 86_400_000) } as any).where(eq(tenants.id, later.tenantId));
      await harness.db.update(tenants).set({ status: 'trial', trialEndsAt: new Date(now.getTime() - 86_400_000) } as any).where(eq(tenants.id, lapsed.tenantId));
      await harness.db.insert(storeConnections).values({ id: uuidv7(), tenantId: client.tenantId, provider: 'salla', externalStoreId: '847769313', status: 'revoked' } as any);
    });
    await product(harness, client.tenantId, 'Oud 41', true);
    await product(harness, client.tenantId, 'Oud 42');
    // A button taken off the shop is not live.
    const withdrawn = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(products).values({ id: withdrawn, tenantId: client.tenantId, name: 'Oud 43', status: 'active' } as any);
      await harness.db.insert(edgeConfigs).values({ id: uuidv7(), tenantId: client.tenantId, productId: withdrawn, key: `k/${withdrawn}`, version: 1, publishedAt: new Date(), withdrawnAt: new Date() } as any);
    });
    await product(harness, stranger.tenantId, 'Not yours', true);

    const stores = await storesOverview({ userId: agency.userId, email: agency.email, isStaff: false }, { requestId: 'r', now });
    assert.deepEqual(stores.map((s) => s.name).sort(), ['agency', 'client', 'ending', 'held', 'lapsed', 'later'], 'its memberships — never the stranger');
    const by = new Map(stores.map((s) => [s.name, s]));

    const c = by.get('client')!;
    assert.deepEqual([c.role, c.plan, c.products, c.liveButtons], ['admin', 'pro', 3, 1], 'read inside the client’s own store; a withdrawn button is not live');
    assert.deepEqual([c.connection?.provider, c.connection?.status, c.connection?.health], ['salla', 'revoked', 'failing']);
    assert.ok(c.attention.includes('connection'));

    assert.ok(by.get('ending')!.attention.includes('trial_ending'), 'a trial ending within three days');
    assert.equal(by.get('ending')!.role, 'editor');
    assert.ok(!by.get('later')!.attention.includes('trial_ending'), 'ten days left is not yet a warning');

    const h = by.get('held')!;
    assert.deepEqual([h.status, h.attention, h.products], ['suspended', ['suspended'], 0], 'listed, nothing read from it');

    // The most urgent first: suspended, then a trial ending, then a broken connection, then setup only.
    assert.deepEqual([by.get('lapsed')!.readOnly, by.get('lapsed')!.attention[0]], ['trial_ended', 'read_only'], 'a trial that ended: read-only');
    assert.deepEqual(stores.map((s) => s.name), ['held', 'lapsed', 'ending', 'client', 'agency', 'later']);

    // A single sign-on session: its own store only (P8).
    const locked = await storesOverview({ userId: agency.userId, email: agency.email, isStaff: false }, { requestId: 'r', onlyTenantId: client.tenantId, now });
    assert.deepEqual(locked.map((s) => s.name), ['client']);

    // The stranger's owner sees only their own.
    const other = await storesOverview({ userId: stranger.userId, email: stranger.email, isStaff: false }, { requestId: 'r', now });
    assert.deepEqual(other.map((s) => [s.name, s.products, s.liveButtons]), [['stranger', 1, 1]]);
  } finally { await harness.close(); }
});

test('a membership that ended is not listed; a store deleted is not listed', async () => {
  const harness = await createTestDb();
  try {
    const agency = await seedTenant(harness, 'agency');
    const gone = await seedTenant(harness, 'gone');
    const left = await seedTenant(harness, 'left');
    await member(harness, gone.tenantId, agency.userId, 'admin');
    await harness.asAdmin(async () => {
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: left.tenantId, userId: agency.userId, role: 'admin', status: 'suspended' } as any);
      await harness.db.update(tenants).set({ deletedAt: new Date() } as any).where(eq(tenants.id, gone.tenantId));
    });
    const stores = await storesOverview({ userId: agency.userId, email: agency.email, isStaff: false }, { requestId: 'r' });
    assert.deepEqual(stores.map((s) => s.name), ['agency']);
  } finally { await harness.close(); }
});
