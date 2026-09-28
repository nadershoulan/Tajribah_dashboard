/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P5.10 — a merchant's try-on settings for a watch (the owner's studio, T26), on the studio's own
 * real cut-outs: transparency read from the file itself, refused pictures deleted at once, a
 * replaced one's bytes removed, switching on only when complete, the plan and the role enforced.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { dailyProductStats, products, subscriptions, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { storageBytesHeld } from '@/server/core/billing/entitlements';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, forTenant, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, seededPlanId, type TestDb } from '@/server/testing/harness';
import { checkCutout, hasAlpha } from '@/server/modules/tryon/cutout';
import { confirmCutout, cutoutFile, startCutoutUpload, tryOnScreen, updateTryOn } from '@/server/modules/tryon/service';

setLogLevel('error');
const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), 'server/modules/tryon/__tests__/fixtures', name)));

test('a cut-out is told from its header: transparency, format, size', () => {
  const worn = fixture('worn.png');
  assert.equal(hasAlpha(worn, 'png'), true);
  assert.deepEqual(checkCutout(worn, worn.length), { ok: true, format: 'png', width: 224, height: 420 });
  assert.deepEqual(checkCutout(fixture('flat.png'), 100), { ok: true, format: 'png', width: 95, height: 213 }, 'the demo’s own flat shot passes');
  assert.deepEqual(checkCutout(fixture('worn.webp'), 100), { ok: true, format: 'webp', width: 224, height: 420 });
  assert.deepEqual(checkCutout(fixture('worn-no-alpha.png'), 100), { ok: false, issue: 'no_transparency' });
  assert.deepEqual(checkCutout(fixture('photo.jpg'), 100), { ok: false, issue: 'not_png_or_webp' });
  assert.deepEqual(checkCutout(fixture('flat-thumb.png'), 100), { ok: false, issue: 'too_small' });
  assert.deepEqual(checkCutout(worn, 11 * 1024 * 1024), { ok: false, issue: 'too_large_file' });
  // A lossy WebP without alpha cannot be a cut-out; the ai-jobs fixture is one.
  const lossy = new Uint8Array(readFileSync(join(process.cwd(), 'server/modules/ai-jobs/__tests__/fixtures/wrist-lossy.webp')));
  assert.equal(hasAlpha(lossy, 'webp'), false);
});

async function proStore(harness: TestDb, name: string, plan: 'pro' | 'starter' = 'pro') {
  setStorage(new MemoryStorage());
  const seeded = await seedTenant(harness, name);
  if (plan === 'pro') {
    const planId = await seededPlanId(harness, 'pro');
    const now = new Date();
    await harness.asAdmin(() => harness.db.insert(subscriptions).values({ id: uuidv7(), tenantId: seeded.tenantId, planId, status: 'active', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000) } as any));
  }
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  const watch = uuidv7();
  const ring = uuidv7();
  await harness.asAdmin(() => harness.db.insert(products).values([
    { id: watch, tenantId: seeded.tenantId, name: 'Steel field watch', nameAr: 'ساعة ميدانية', sku: 'SFW-38', productType: 'watch', dimensions: { widthMm: 38, heightMm: 46 } },
    { id: ring, tenantId: seeded.tenantId, name: 'Ring', productType: 'jewelry' },
  ] as any));
  return { ...seeded, ctx, watch, ring };
}

/** Start → the browser's PUT → confirm, as the screen does it. */
async function upload(ctx: any, productId: string, slot: 'worn' | 'flat', bytes: Uint8Array, contentType = 'image/png') {
  const started = await startCutoutUpload(ctx, productId, { slot, filename: `${slot}.png`, contentType, sizeBytes: bytes.length });
  await forTenant(ctx.tenantId).put(started.key, bytes.slice().buffer as ArrayBuffer);
  return { key: started.key, view: await confirmCutout(ctx, productId, { slot, key: started.key }) };
}

test('set up a watch: both pictures, the case width, a finish — then switch it on', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, watch } = await proStore(harness, 'alpha');
    const first = await tryOnScreen(ctx);
    assert.equal(first.included, true);
    assert.deepEqual(first.watches.map((w) => [w.productId, w.productWidthMm, w.ready, w.missing]), [[watch, 38, false, ['worn', 'flat', 'case']]], 'only watches are listed');

    await assert.rejects(() => updateTryOn(ctx, watch, { enabled: true }), (e: any) => e.code === 'conflict' && /missing: worn, flat, case/.test(e.message));
    const worn = await upload(ctx, watch, 'worn', fixture('worn.png'));
    assert.deepEqual(worn.view.worn, { bytes: fixture('worn.png').length });
    await upload(ctx, watch, 'flat', fixture('flat.png'));
    const sized = await updateTryOn(ctx, watch, { caseMm: 38.4, finishAr: 'فولاذ · مينا أسود', finishEn: 'Steel · black dial' });
    assert.deepEqual([sized.caseMm, sized.finish, sized.ready, sized.enabled], [38.4, { ar: 'فولاذ · مينا أسود', en: 'Steel · black dial' }, true, false]);
    const on = await updateTryOn(ctx, watch, { enabled: true });
    assert.equal(on.enabled, true);

    const file = await cutoutFile(ctx, watch, 'worn');
    assert.equal(new Uint8Array(await new Response(file.body).arrayBuffer()).length, fixture('worn.png').length);
    assert.ok((await storageBytesHeld(ctx)) >= fixture('worn.png').length + fixture('flat.png').length, 'the pictures count against storage');
  } finally { await harness.close(); }
});

test('refused pictures are deleted with the reason; a replaced picture’s bytes go; only this store’s cut-out keys attach', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, watch, ring } = await proStore(harness, 'alpha');
    const store = forTenant(tenantId);
    for (const [name, pattern] of [['worn-no-alpha.png', /no transparency/], ['flat-thumb.png', /too small/]] as const) {
      const started = await startCutoutUpload(ctx, watch, { slot: 'worn', filename: name, contentType: 'image/png', sizeBytes: 100 });
      await store.put(started.key, fixture(name).slice().buffer as ArrayBuffer);
      await assert.rejects(() => confirmCutout(ctx, watch, { slot: 'worn', key: started.key }), (e: any) => e.code === 'validation_failed' && pattern.test(JSON.stringify(e.errors)));
      assert.equal(await store.head(started.key), null, `${name}: refused bytes deleted`);
    }
    await assert.rejects(() => startCutoutUpload(ctx, watch, { slot: 'worn', filename: 'w.jpg', contentType: 'image/jpeg', sizeBytes: 100 }), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => startCutoutUpload(ctx, ring, { slot: 'worn', filename: 'w.png', contentType: 'image/png', sizeBytes: 100 }), (e: any) => e.code === 'conflict' && /watches/.test(e.message));

    const one = await upload(ctx, watch, 'worn', fixture('worn.png'));
    const two = await upload(ctx, watch, 'worn', fixture('worn.webp'), 'image/webp');
    assert.equal(await store.head(one.key), null, 'the replaced picture’s bytes are deleted');
    assert.ok(await store.head(two.key));

    // A key that is not a worn cut-out of this store is not attached, whatever it points at.
    const otherFile = store.key({ kind: 'model', id: uuidv7(), filename: 'model.glb' });
    await store.put(otherFile, fixture('worn.png').slice().buffer as ArrayBuffer);
    await assert.rejects(() => confirmCutout(ctx, watch, { slot: 'worn', key: otherFile }), (e: any) => e.code === 'not_found');
    await assert.rejects(() => confirmCutout(ctx, watch, { slot: 'flat', key: two.key }), (e: any) => e.code === 'not_found', 'a worn key is not a flat one');
    await assert.rejects(() => confirmCutout(ctx, watch, { slot: 'worn', key: `t/${uuidv7()}/photo/${uuidv7()}/worn.png` }), (e: any) => e.code === 'not_found', 'another store’s key');

    await assert.rejects(() => updateTryOn(ctx, watch, { caseMm: 120 }), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => updateTryOn(ctx, watch, { finishAr: 'ذهبي', finishEn: '' }), (e: any) => e.code === 'validation_failed', 'both languages or neither');
  } finally { await harness.close(); }
});

test('the plan and the role: a Starter store can look but not set up; an analyst can look but not change', async () => {
  const harness = await createTestDb();
  try {
    const starter = await proStore(harness, 'bravo', 'starter');
    const screen = await tryOnScreen(starter.ctx);
    assert.equal(screen.included, false);
    await assert.rejects(() => startCutoutUpload(starter.ctx, starter.watch, { slot: 'worn', filename: 'w.png', contentType: 'image/png', sizeBytes: 100 }), (e: any) => e.code === 'plan_required');
    await assert.rejects(() => updateTryOn(starter.ctx, starter.watch, { caseMm: 38 }), (e: any) => e.code === 'plan_required');

    const pro = await proStore(harness, 'alpha');
    const analystId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: analystId, email: 'an@example.test', passwordHash: 'x', fullName: 'A' } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: pro.tenantId, userId: analystId, role: 'analyst', status: 'active' } as any);
    });
    const analyst = await buildTenantContext({ actor: { userId: analystId, email: 'an@example.test', isStaff: false }, tenantId: pro.tenantId, requestId: 'r' });
    assert.equal((await tryOnScreen(analyst)).watches.length, 1);
    await assert.rejects(() => updateTryOn(analyst, pro.watch, { caseMm: 38 }), (e: any) => e.code === 'forbidden');
    await assert.rejects(() => updateTryOn(starter.ctx, pro.watch, { caseMm: 38 }), (e: any) => e.code === 'plan_required' || e.code === 'not_found');
  } finally { await harness.close(); }
});

test('P5.13: each watch shows its last 30 Riyadh days from the rollup — this store only, and only to those who may read analytics', async () => {
  const harness = await createTestDb();
  try {
    // 22:00 UTC on 27 Sep is already 28 Sep in Riyadh: the 30 days run 30 Aug – 28 Sep.
    const NOW = new Date('2026-09-27T22:00:00Z');
    const { ctx, watch, tenantId } = await proStore(harness, 'alpha');
    const other = await seedTenant(harness, 'bravo');
    const dress = uuidv7();
    await harness.asAdmin(() => harness.db.insert(products).values({ id: dress, tenantId, name: 'Dress watch', productType: 'watch' } as any));
    await harness.asAdmin(() => harness.db.insert(dailyProductStats).values([
      { tenantId, productId: dress, day: '2026-09-28', views: 40, tryonSessions: 4 },
      { tenantId, productId: watch, day: '2026-09-28', views: 100, tryonSessions: 12 },
      { tenantId, productId: watch, day: '2026-08-30', views: 50, tryonSessions: 3 },
      { tenantId, productId: watch, day: '2026-08-29', views: 999, tryonSessions: 999 }, // a day too early
      { tenantId: other.tenantId, productId: watch, day: '2026-09-28', views: 7000, tryonSessions: 700 }, // another store's row
    ] as any));

    const screen = await tryOnScreen(ctx, NOW);
    const byId = Object.fromEntries(screen.watches.map((w) => [w.productId, w.last30]));
    assert.deepEqual(byId, { [watch]: { views: 150, tryonSessions: 15 }, [dress]: { views: 40, tryonSessions: 4 } }, 'each watch its own days');

    const noAnalytics = Object.assign(Object.create(ctx), { can: (p: string) => p !== 'analytics:read' && ctx.can(p as never) });
    assert.deepEqual((await tryOnScreen(noAnalytics, NOW)).watches.map((w) => w.last30), [null, null], 'no analytics permission: no numbers');

    const changed = await updateTryOn(ctx, watch, { caseMm: 38 });
    assert.equal(changed.last30, null, 'a change returns the settings only; the screen keeps the list’s numbers');
  } finally { await harness.close(); }
});
