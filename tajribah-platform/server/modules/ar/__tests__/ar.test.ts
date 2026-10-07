/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { arConfigs, auditLogs, products, tenantMemberships, tryonConfigs, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { listArConfigPage, listArConfigs, saveArConfig } from '@/server/modules/ar/service';

setLogLevel('error');
const code = (e: any) => e.code;
const admin = <T>(harness: TestDb, fn: () => Promise<T>) => harness.asAdmin(fn);
const INPUT = { buttonLabelAr: 'جرّبها على معصمك', buttonLabelEn: 'Try it on', variant: 'outline', showIcon: false, placement: 'wrist', scale: 1.1, autoRotate: false, shadow: 0.5 };

async function store(harness: TestDb, name: string, role: 'owner' | 'analyst' = 'owner') {
  const seeded = await seedTenant(harness, name);
  let userId = seeded.userId;
  if (role !== 'owner') {
    userId = uuidv7();
    await admin(harness, async () => {
      await harness.db.insert(users).values({ id: userId, email: `${role}-${name}@example.test`, passwordHash: 'x', fullName: role } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: seeded.tenantId, userId, role, status: 'active' } as any);
    });
  }
  return { ...seeded, ctx: await buildTenantContext({ actor: { userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` }) };
}
const product = async (harness: TestDb, tenantId: string, over: any) =>
  ((await admin(harness, () => harness.db.insert(products).values({ tenantId, name: 'P', ...over } as any).returning())) as any[])[0];

test('defaults are shown, not stored; saving stores exactly what was set, audited, and reads back', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const watch = await product(harness, tenantId, { name: 'Watch', productType: 'watch' });
    const sofa = await product(harness, tenantId, { name: 'Sofa', productType: 'furniture' });
    await product(harness, tenantId, { name: 'Gone', status: 'archived' });

    const before = await listArConfigs(ctx);
    assert.deepEqual(before.map((c) => [c.productName, c.placement, c.saved]).sort(), [['Sofa', 'floor', false], ['Watch', 'wrist', false]], 'a sensible placement per type; archived products are not listed');
    assert.equal((await admin(harness, () => harness.db.select().from(arConfigs))).length, 0, 'nothing written by looking');

    const saved = await saveArConfig(ctx, watch.id, INPUT);
    assert.deepEqual([saved.buttonLabelAr, saved.variant, saved.showIcon, saved.placement, saved.scale, saved.shadow, saved.autoRotate, saved.saved, saved.unpublishedChanges],
      ['جرّبها على معصمك', 'outline', false, 'wrist', 1.1, 0.5, false, true, true]);
    const [row] = await admin(harness, () => harness.db.select().from(arConfigs).where(eq(arConfigs.productId, watch.id))) as any[];
    assert.deepEqual([row.scaleFactorBp, row.shadowIntensityBp], [11_000, 5_000], 'stored in basis points');
    const again = await saveArConfig(ctx, watch.id, { ...INPUT, scale: 1 });
    assert.equal(again.scale, 1);
    assert.equal((await admin(harness, () => harness.db.select().from(arConfigs))).length, 1, 'one row per product');
    const trail = await admin(harness, () => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceType, 'ar_config'))) as any[];
    assert.deepEqual(trail.map((r) => r.action), ['create', 'update']);
    // T104: the default style is minimal; a style chosen is kept as chosen, minimal included
    assert.equal(before.find((c) => c.productName === 'Sofa')!.variant, 'minimal', 'never chosen: minimal, no colour of its own');
    for (const variant of ['solid', 'minimal'] as const) assert.equal((await saveArConfig(ctx, sofa.id, { ...INPUT, placement: 'floor', variant })).variant, variant);
  } finally { await harness.close(); }
});

test('placement fits the product; labels and ranges are checked', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const sofa = await product(harness, tenantId, { name: 'Sofa', productType: 'furniture' });
    const glasses = await product(harness, tenantId, { name: 'Glasses', productType: 'eyewear' });
    const refused = (id: string, over: any, field: string) =>
      assert.rejects(() => saveArConfig(ctx, id, { ...INPUT, ...over }), (e: any) => code(e) === 'validation_failed' && field in e.errors);
    await refused(sofa.id, { placement: 'wrist' }, 'placement');
    await refused(sofa.id, { placement: 'face' }, 'placement');
    await refused(glasses.id, { placement: 'floor' }, 'placement');
    assert.equal((await saveArConfig(ctx, glasses.id, { ...INPUT, placement: 'face' })).placement, 'face');
    await refused(sofa.id, { placement: 'floor', buttonLabelAr: '' }, 'buttonLabelAr');
    await refused(sofa.id, { placement: 'floor', buttonLabelEn: 'x'.repeat(41) }, 'buttonLabelEn');
    await refused(sofa.id, { placement: 'floor', buttonLabelAr: 'ع'.repeat(41) }, 'buttonLabelAr');
    await refused(sofa.id, { placement: 'floor', scale: 3 }, 'scale');
    await refused(sofa.id, { placement: 'floor', shadow: -1 }, 'shadow');
    await assert.rejects(() => saveArConfig(ctx, sofa.id, { ...INPUT, placement: 'floor', extra: 1 }), (e: any) => code(e) === 'validation_failed');
  } finally { await harness.close(); }
});

test('an analyst reads but cannot save; another store cannot touch this store\'s products', async () => {
  const harness = await createTestDb();
  try {
    const a = await store(harness, 'alpha');
    const watch = await product(harness, a.tenantId, { name: 'Watch', productType: 'watch' });
    const analyst = await store(harness, 'gamma', 'analyst');
    await assert.rejects(() => saveArConfig(analyst.ctx, watch.id, INPUT), (e: any) => code(e) === 'forbidden');
    const b = await store(harness, 'beta');
    await assert.rejects(() => saveArConfig(b.ctx, watch.id, INPUT), (e: any) => code(e) === 'not_found');
    assert.deepEqual(await listArConfigs(b.ctx), []);
  } finally { await harness.close(); }
});

test('T73: numbered pages, products already set up first, and a search', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    // The set-up ones are the oldest: newest-first alone would put them last.
    const shown = await product(harness, tenantId, { name: 'Shown lamp', arEnabled: true, dimensions: { widthMm: 100, heightMm: 200 } });
    const tried = await product(harness, tenantId, { name: 'Tried watch', productType: 'watch' });
    await admin(harness, () => harness.db.insert(tryonConfigs).values({ id: uuidv7(), tenantId, productId: tried.id, category: 'watch' } as any));
    const custom = await product(harness, tenantId, { name: 'Custom sofa', productType: 'furniture' });
    await saveArConfig(ctx, custom.id, { ...INPUT, placement: 'floor' });
    await product(harness, tenantId, { name: 'Gone', status: 'archived', arEnabled: true });
    const plain = [];
    for (let i = 0; i < 7; i++) plain.push(await product(harness, tenantId, { name: `Plain ${i}`, sku: `PL-${i}` }));

    const first = await listArConfigPage(ctx, { page: 1, pageSize: 4 });
    assert.equal(first.total, 10, 'archived products are not counted');
    assert.deepEqual(first.configs.slice(0, 3).map((c) => c.productName), ['Custom sofa', 'Tried watch', 'Shown lamp'], 'set up first — 3D on, a try-on, saved settings — newest first');
    assert.equal(first.configs[3]!.productName, 'Plain 6', 'then the rest, newest first');
    const second = await listArConfigPage(ctx, { page: 2, pageSize: 4 });
    assert.deepEqual(second.configs.map((c) => c.productName), ['Plain 5', 'Plain 4', 'Plain 3', 'Plain 2'], 'page 2 follows on with no gap or repeat');
    const last = await listArConfigPage(ctx, { page: 99, pageSize: 4 });
    assert.deepEqual([last.page, last.configs.map((c) => c.productName)], [3, ['Plain 1', 'Plain 0']], 'past the end: the last page');

    const found = await listArConfigPage(ctx, { q: 'pl-3' });
    assert.deepEqual([found.total, found.configs.map((c) => c.productName)], [1, ['Plain 3']], 'the SKU, any case');
    assert.equal((await listArConfigPage(ctx, { q: 'watch' })).configs[0]!.productName, 'Tried watch');
    assert.equal((await listArConfigPage(ctx, { q: '100%' })).total, 0, 'a % is a character, not a wildcard');
    void plain; void shown;
  } finally { await harness.close(); }
});
