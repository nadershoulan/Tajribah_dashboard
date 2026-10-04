/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Recommendations, first version — products often viewed together: counted from real visit events
 * (view, AR, try-on in one visit), top four with at least three shared visits, last 30 days only, the
 * store's own events only; the same rows when run twice; once a night per store; shown to shoppers
 * (the product page's config) on Pro and up, and only products a shopper can open.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { analyticsEvents, dailyTenantStats, jobs, productRelations, products, relationRuns, tryonConfigs } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { MemoryConfigStore, setConfigStore } from '@/server/core/edge/configs';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { computeRelations, refreshRelations } from '@/server/modules/recommendations/compute';
import { relatedOf } from '@/server/modules/recommendations/service';
import { handleEdgeJob, publishProduct, refreshProduct, unpublishProduct } from '@/server/modules/edge/publish';
import { entitlementsOf } from '@/server/core/billing/entitlements';
import { hostedProductFrom } from '@site/lib/hosted-page';

setLogLevel('error');
const NOW = new Date('2026-10-03T06:00:00Z'); // 09:00 Riyadh
class CdnStorage extends MemoryStorage { publicUrl(k: string) { return `https://cdn.example.test/${k}`; } }

async function store(harness: TestDb, name: string, plan: 'growth' | 'pro') {
  setStorage(new CdnStorage());
  const kv = new MemoryConfigStore();
  setConfigStore(kv);
  const seeded = await seedTenant(harness, name, { plan });
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx, kv };
}

/** A watch whose try-on is set up, so it can be published (its own page exists). */
async function watch(harness: TestDb, tenantId: string, name: string, over: Record<string, unknown> = {}) {
  const [row] = (await harness.asAdmin(() => harness.db.insert(products).values({ tenantId, name, nameAr: `${name} ع`, productType: 'watch', externalId: `sa-${name}`, ...over } as any).returning())) as any[];
  await harness.asAdmin(() => harness.db.insert(tryonConfigs).values({
    id: uuidv7(), tenantId, productId: row.id, category: 'watch', wornKey: `t/${tenantId}/photo/${row.id}/worn.webp`, wornBytes: 1, flatKey: `t/${tenantId}/photo/${row.id}/flat.webp`, flatBytes: 1, caseTenthsMm: 380, enabled: true,
  } as any));
  return row;
}

async function visits(harness: TestDb, tenantId: string, count: number, productIds: string[], { type = 'product_view', daysAgo = 1, tag = 's' } = {}) {
  const at = new Date(NOW.getTime() - daysAgo * 86_400_000);
  const rows: Record<string, unknown>[] = [];
  for (let i = 0; i < count; i++) for (const productId of productIds) rows.push({ id: uuidv7(), tenantId, eventType: type, productId, sessionId: `${tag}-${productIds.join('')}-${i}`, occurredAt: at });
  await harness.asAdmin(() => harness.db.insert(analyticsEvents).values(rows as any));
}

test('pairs come from visits that saw both: top four, at least three visits, 30 days, this store only; the same when run twice', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'oud', 'pro');
    const [a, b, c, d, e] = await Promise.all(['A', 'B', 'C', 'D', 'E'].map((n) => watch(harness, tenantId, n)));
    await visits(harness, tenantId, 5, [a.id, b.id]);
    await visits(harness, tenantId, 3, [a.id, c.id], { type: 'tryon_start' });
    await visits(harness, tenantId, 2, [a.id, d.id]); // below three: chance
    await visits(harness, tenantId, 6, [a.id, e.id], { type: 'add_to_cart' }); // not a look at the product
    await visits(harness, tenantId, 6, [a.id, d.id], { daysAgo: 40, tag: 'old' }); // outside 30 days
    const other = await store(harness, 'other', 'pro');
    const x = await watch(harness, other.tenantId, 'X');
    await harness.asAdmin(() => harness.db.insert(analyticsEvents).values([0, 1, 2, 3].map((i) => ({ id: uuidv7(), tenantId: other.tenantId, eventType: 'product_view', productId: x.id, sessionId: `${'s'}-${a.id}${b.id}-${i}`, occurredAt: new Date(NOW.getTime() - 86_400_000) })) as any));

    const first = await computeRelations(tenantId, NOW);
    assert.deepEqual(first, { pairs: 4, changed: true }, 'A→B, A→C, B→A, C→A');
    const related = await relatedOf(ctx, a.id);
    assert.deepEqual(related.related.map((r) => [r.name, r.sessions]), [['B', 5], ['C', 3]], 'most shared visits first; another store’s visits with the same id do not count');
    assert.equal(related.shownToShoppers, true, 'Pro shows them to shoppers');
    assert.deepEqual((await relatedOf(ctx, b.id)).related.map((r) => r.name), ['A']);
    assert.deepEqual(await computeRelations(tenantId, NOW), { pairs: 4, changed: false }, 'recomputed whole: the same rows');

    await harness.asAdmin(() => harness.db.update(products).set({ deletedAt: new Date() } as any).where(eq(products.id, c.id)));
    await computeRelations(tenantId, NOW);
    assert.deepEqual((await relatedOf(ctx, a.id)).related.map((r) => r.name), ['B'], 'a deleted product drops out');
    const stored = await harness.asAdmin(() => harness.db.select().from(productRelations).where(eq(productRelations.relatedProductId, c.id))) as any[];
    assert.equal(stored.length, 0, 'not kept at all, not only hidden');

    const hub = await watch(harness, tenantId, 'H');
    const partners = await Promise.all(['P1', 'P2', 'P3', 'P4', 'P5'].map((n) => watch(harness, tenantId, n)));
    for (const [i, partner] of partners.entries()) await visits(harness, tenantId, 3 + i, [hub.id, partner.id], { tag: `h${i}` });
    await computeRelations(tenantId, NOW);
    assert.deepEqual((await relatedOf(ctx, hub.id)).related.map((r) => r.name), ['P5', 'P4', 'P3', 'P2'], 'four at most, the strongest');
  } finally { await harness.close(); }
});

test('on Pro the product page lists only related products a shopper can open; Growth shows none to shoppers', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await store(harness, 'oud2', 'pro');
    const a = await watch(harness, tenantId, 'A');
    const b = await watch(harness, tenantId, 'B');
    await visits(harness, tenantId, 4, [a.id, b.id]);
    await computeRelations(tenantId, NOW);
    await publishProduct(ctx, a.id);
    assert.deepEqual(JSON.parse(kv.entries.get('oud2/sa-A.json')!.body).related, [], 'B is not live: nothing to open');
    await publishProduct(ctx, b.id);
    await refreshProduct(ctx, a.id, await entitlementsOf(ctx));
    const config = JSON.parse(kv.entries.get('oud2/sa-A.json')!.body);
    assert.deepEqual(config.related, [{ ref: 'sa-B', name: 'B', nameAr: 'B ع' }]);
    assert.deepEqual(hostedProductFrom(config)!.related, [{ ref: 'sa-B', name: { ar: 'B ع', en: 'B' } }], 'the website reads it');

    const growth = await store(harness, 'oud3', 'growth');
    const g1 = await watch(harness, growth.tenantId, 'G1');
    const g2 = await watch(harness, growth.tenantId, 'G2');
    await visits(harness, growth.tenantId, 4, [g1.id, g2.id]);
    await computeRelations(growth.tenantId, NOW);
    assert.equal((await relatedOf(growth.ctx, g1.id)).related.length, 1, 'the merchant still sees them');
    assert.equal((await relatedOf(growth.ctx, g1.id)).shownToShoppers, false);
    await publishProduct(growth.ctx, g1.id);
    assert.equal(JSON.parse(growth.kv.entries.get('oud3/sa-G1.json')!.body).related, null, 'not on the page below Pro');
  } finally { await harness.close(); }
});

test('the nightly pass: from 03:00 Riyadh, each store with visits once a day; a change refreshes its pages', async () => {
  const harness = await createTestDb();
  try {
    const { tenantId } = await store(harness, 'oud4', 'pro');
    const a = await watch(harness, tenantId, 'A');
    const b = await watch(harness, tenantId, 'B');
    await visits(harness, tenantId, 3, [a.id, b.id]);
    await harness.asAdmin(() => harness.db.insert(dailyTenantStats).values({ tenantId, day: '2026-10-02', views: 6 } as any));
    assert.deepEqual(await refreshRelations(new Date('2026-10-02T23:00:00Z')), { computed: 0, failed: 0 }, '02:00 Riyadh: not yet');
    assert.deepEqual(await refreshRelations(NOW), { computed: 1, failed: 0 });
    const [run] = (await harness.asAdmin(() => harness.db.select().from(relationRuns).where(eq(relationRuns.tenantId, tenantId)))) as any[];
    assert.deepEqual([run.day, run.pairs], ['2026-10-03', 2]);
    assert.ok((await harness.asAdmin(() => harness.db.select().from(jobs).where(eq(jobs.queue, 'edge.publish-config')))).length >= 1, 'its pages are refreshed');
    assert.deepEqual(await refreshRelations(new Date(NOW.getTime() + 3_600_000)), { computed: 0, failed: 0 }, 'once a day');
    assert.deepEqual(await refreshRelations(new Date(NOW.getTime() + 86_400_000)), { computed: 1, failed: 0 }, 'and again the next night');
    const twoAtOnce = await Promise.all([refreshRelations(new Date(NOW.getTime() + 2 * 86_400_000)), refreshRelations(new Date(NOW.getTime() + 2 * 86_400_000))]);
    assert.equal(twoAtOnce[0].computed + twoAtOnce[1].computed, 1, 'two passes at once compute a store once');
  } finally { await harness.close(); }
});

/** Run the store's queued config refreshes as the worker would, round after round, until none are left. */
async function drainRefreshes(harness: TestDb, tenantId: string): Promise<string[]> {
  const ran: string[] = [];
  for (let round = 0; round < 10; round++) {
    const queued = await harness.asAdmin(() => harness.db.select().from(jobs).where(and(eq(jobs.queue, 'edge.publish-config'), eq(jobs.tenantId, tenantId), eq(jobs.state, 'queued')))) as any[];
    if (queued.length === 0) return ran;
    for (const job of queued) {
      await harness.asAdmin(() => harness.db.update(jobs).set({ state: 'done' } as any).where(eq(jobs.id, job.id)));
      await handleEdgeJob(job);
      ran.push(job.payload.productId);
    }
  }
  throw new Error('the refreshes never stopped');
}

test('a related product published, removed or withdrawn reaches the lists that name it at once — not the next night — and the refreshes stop', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, kv } = await store(harness, 'oud4', 'pro');
    const a = await watch(harness, tenantId, 'A');
    const b = await watch(harness, tenantId, 'B');
    const c = await watch(harness, tenantId, 'C'); // lists B too, but is not published: left alone
    await visits(harness, tenantId, 4, [a.id, b.id]);
    await visits(harness, tenantId, 4, [c.id, b.id]);
    await computeRelations(tenantId, NOW);
    await publishProduct(ctx, a.id);
    await drainRefreshes(harness, tenantId);
    const relatedOfA = () => JSON.parse(kv.entries.get('oud4/sa-A.json')!.body).related;
    assert.deepEqual(relatedOfA(), [], 'B is not live yet');

    await publishProduct(ctx, b.id);
    const ran = await drainRefreshes(harness, tenantId);
    assert.deepEqual(relatedOfA(), [{ ref: 'sa-B', name: 'B', nameAr: 'B ع' }], 'B published: A lists it now');
    assert.ok(!ran.includes(c.id), 'a product not on the shop is not refreshed');
    assert.ok(ran.length <= 3, `A refreshed, then B once more for A's new version, then nothing changes: ${ran.length}`);

    await unpublishProduct(ctx, b.id);
    await drainRefreshes(harness, tenantId);
    assert.deepEqual(relatedOfA(), [], 'B removed from the shop: gone from A at once');

    await publishProduct(ctx, b.id);
    await drainRefreshes(harness, tenantId);
    assert.equal(relatedOfA().length, 1);
    await harness.asAdmin(() => harness.db.update(products).set({ status: 'archived' } as any).where(eq(products.id, b.id)));
    await refreshProduct(ctx, b.id, await entitlementsOf(ctx)); // B withdrawn: archived
    await drainRefreshes(harness, tenantId);
    assert.deepEqual(relatedOfA(), [], 'B withdrawn: gone from A at once');
  } finally { await harness.close(); }
});
