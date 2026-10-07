/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T99 — at the owner's one request (the QR codes screen), every published product whose own page has no buy
 * link gets its store page (from its feed) as the buy link: a link the owner set is never touched, a page
 * switched off stays off, an unpublished product or an insecure page is skipped; more than a few pages go
 * live through one store-wide refresh.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { auditLogs, edgeConfigs, hostedPages, jobs, products, tenantMemberships, tryonConfigs, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { MemoryConfigStore, setConfigStore } from '@/server/core/edge/configs';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { publishProduct } from '@/server/modules/edge/publish';
import { applyStorePages, STORE_PAGES_AT_ONCE } from '@/server/modules/hosted-pages/service';
import { qrCodesFor } from '@/server/modules/hosted-pages/qr';

setLogLevel('error');
class CdnStorage extends MemoryStorage { publicUrl(k: string) { return `https://cdn.example.test/${k}`; } }

async function setup(harness: TestDb, name: string) {
  resetEnv();
  loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 'a'.repeat(40), ENCRYPTION_KEY: 'b'.repeat(40) });
  setStorage(new CdnStorage());
  const kv = new MemoryConfigStore();
  setConfigStore(kv);
  const seeded = await seedTenant(harness, name, { plan: 'pro' });
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  return { ...seeded, ctx, kv };
}

/** A watch whose try-on is complete (publishable), with its page in the store when given. */
async function watch(harness: TestDb, tenantId: string, ref: string, pageUrl: string | null) {
  const [row] = await harness.asAdmin(() => harness.db.insert(products).values({ tenantId, name: `Watch ${ref}`, productType: 'watch', externalId: ref, pageUrl } as any).returning()) as any[];
  await harness.asAdmin(() => harness.db.insert(tryonConfigs).values({
    id: uuidv7(), tenantId, productId: row.id, category: 'watch', wornKey: `t/${tenantId}/photo/${row.id}/worn.webp`, wornBytes: 100,
    flatKey: `t/${tenantId}/photo/${row.id}/flat.webp`, flatBytes: 100, caseTenthsMm: 400, enabled: true,
  } as any));
  return row;
}

const page = (n: string) => `https://failet.sa/ar/x/p${n}?tax_profile=sa`;
const linkOf = async (harness: TestDb, productId: string) => ((await harness.asAdmin(() => harness.db.select().from(hostedPages).where(eq(hostedPages.productId, productId)))) as any[])[0] ?? null;
const shopUrlIn = (kv: MemoryConfigStore, ref: string, store: string) => JSON.parse(kv.entries.get(`${store}/${ref}.json`)!.body).page?.shopUrl ?? null;

test('every published page without a buy link gets its store page; the owner’s own links, a page switched off, the unpublished and the insecure are respected', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await setup(harness, 'links');
    const plain = await watch(harness, tenantId, '1001', page('1001'));
    const owned = await watch(harness, tenantId, '1002', page('1002'));
    const off = await watch(harness, tenantId, '1003', page('1003'));
    const insecure = await watch(harness, tenantId, '1004', 'http://failet.sa/ar/x/p1004');
    const unpublished = await watch(harness, tenantId, '1005', page('1005'));
    for (const p of [plain, owned, off, insecure]) await publishProduct(ctx, p.id);
    await harness.asAdmin(() => harness.db.insert(hostedPages).values([
      { id: uuidv7(), tenantId, productId: owned.id, isActive: true, shopUrl: 'https://failet.sa/campaign/oyster' },
      { id: uuidv7(), tenantId, productId: off.id, isActive: false, shopUrl: null },
    ] as any));

    assert.equal((await qrCodesFor(ctx)).withoutBuyLink, 1, 'the screen counts the listed pages it can link (the one switched off has no code)');
    assert.deepEqual(await applyStorePages(ctx), { updated: 2 });
    assert.equal((await linkOf(harness, plain.id)).shopUrl, page('1001'));
    assert.equal(shopUrlIn(kv, '1001', 'links'), page('1001'), 'live at once: shoppers see the buy link');
    assert.equal((await linkOf(harness, owned.id)).shopUrl, 'https://failet.sa/campaign/oyster', 'the owner’s own link stays');
    assert.deepEqual([(await linkOf(harness, off.id)).shopUrl, (await linkOf(harness, off.id)).isActive], [page('1003'), false], 'linked, and still switched off');
    assert.equal(await linkOf(harness, insecure.id), null, 'an insecure page is not a buy link');
    assert.equal(await linkOf(harness, unpublished.id), null, 'an unpublished product has no page to link');
    assert.equal((await qrCodesFor(ctx)).withoutBuyLink, 0);
    const trail = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, tenantId), eq(auditLogs.resourceType, 'hosted_page')))) as any[];
    assert.equal(trail.length, 2, 'each change audited');
    assert.deepEqual(await applyStorePages(ctx), { updated: 0 }, 'again: nothing left to link');

    const viewerId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: viewerId, email: 'viewer@links.sa', passwordHash: 'x', fullName: 'V' } as any);
      await harness.db.insert(tenantMemberships).values({ tenantId, userId: viewerId, role: 'viewer' } as any);
    });
    const viewer = await buildTenantContext({ actor: { userId: viewerId, email: 'viewer@links.sa', isStaff: false }, tenantId, requestId: 'r' });
    await assert.rejects(() => applyStorePages(viewer), (e: any) => e.code === 'forbidden', 'publishing’s permission');
  } finally { await harness.close(); resetEnv(); }
});

test('more pages than a request should rebuild one by one: one store-wide refresh brings them live', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await setup(harness, 'many');
    const count = STORE_PAGES_AT_ONCE + 1;
    const rows = await harness.asAdmin(() => harness.db.insert(products).values(Array.from({ length: count }, (_, i) => ({
      tenantId, name: `Watch ${i}`, productType: 'watch', externalId: `m-${i}`, pageUrl: page(String(2000 + i)),
    })) as any).returning()) as any[];
    await harness.asAdmin(() => harness.db.insert(edgeConfigs).values(rows.map((r) => ({ id: uuidv7(), tenantId, productId: r.id, key: `many/${r.externalId}.json`, version: 1, fingerprint: 'f', publishedAt: new Date() })) as any));
    assert.deepEqual(await applyStorePages(ctx), { updated: count });
    const queued = await harness.asAdmin(() => harness.db.select().from(jobs).where(and(eq(jobs.tenantId, tenantId), eq(jobs.queue, 'edge.publish-config')))) as any[];
    assert.equal(queued.length, 1, 'one refresh of the whole store, not one rebuild per page in the request');
  } finally { await harness.close(); resetEnv(); }
});
