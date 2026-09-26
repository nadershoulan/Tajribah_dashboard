/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P2.12 — coupons: validated on the server, never below zero, once per store, never past
 * their limit; the catalogue is read-only to the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { appDb } from '@/db/client';
import { couponRedemptions, coupons } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { withTenant } from '@/server/core/tenancy/rls';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { checkCoupon, couponProblem, discountOf, redeemCoupon } from '@/server/modules/billing/coupons';

setLogLevel('error');
const NOW = new Date('2026-10-05T09:00:00Z');

async function store(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx };
}

const base = { id: uuidv7(), code: 'X', kind: 'percent', percentOff: 20, amountOffMinor: null, freeMonths: null, appliesTo: null, maxRedemptions: null, validFrom: null, validUntil: null, active: true, note: null, createdAt: NOW, updatedAt: NOW } as any;
const plant = (harness: TestDb, rows: any[]) => harness.asAdmin(() => harness.db.insert(coupons).values(rows.map((r) => ({ ...base, id: uuidv7(), ...r }))));
const refused = (pattern: RegExp) => (e: any) => e.code === 'validation_failed' && pattern.test(e.errors?.code?.[0] ?? '');

test('the rules and the discount, as pure functions', () => {
  const ok = { plan: 'growth' as const, cycle: 'monthly' as const, now: NOW, redemptions: 0, usedByStore: false };
  assert.equal(couponProblem(base, ok), null);
  assert.match(couponProblem({ ...base, active: false }, ok)!, /no longer active/);
  assert.match(couponProblem({ ...base, validFrom: new Date('2026-11-01T00:00:00Z') }, ok)!, /not valid yet/);
  assert.match(couponProblem({ ...base, validUntil: NOW }, ok)!, /expired/, 'the end is exclusive');
  assert.match(couponProblem({ ...base, appliesTo: ['pro'] }, ok)!, /not for the Growth plan/);
  assert.match(couponProblem({ ...base, kind: 'free_months', freeMonths: 2 }, { ...ok, cycle: 'annual' })!, /monthly billing/);
  assert.match(couponProblem({ ...base, maxRedemptions: 3 }, { ...ok, redemptions: 3 })!, /used up/);
  assert.match(couponProblem(base, { ...ok, usedByStore: true })!, /already used/);

  assert.deepEqual(discountOf(base, 29_900), { discountMinor: 5_980, freeMonths: 0 });
  assert.deepEqual(discountOf({ ...base, percentOff: 15 }, 9_900), { discountMinor: 1_485, freeMonths: 0 });
  assert.deepEqual(discountOf({ ...base, percentOff: 33 }, 101), { discountMinor: 33, freeMonths: 0 }, 'half-up to the halala');
  assert.deepEqual(discountOf({ ...base, kind: 'fixed', amountOffMinor: 50_000 }, 29_900), { discountMinor: 29_900, freeMonths: 0 }, 'never below zero');
  assert.deepEqual(discountOf({ ...base, kind: 'free_months', freeMonths: 2 }, 29_900), { discountMinor: 0, freeMonths: 2 });
});

test('checking a code at checkout: the server decides, whatever case it is typed in', async () => {
  setRateLimiter(new MemoryRateLimiter());
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    await plant(harness, [
      { code: 'WELCOME20' },
      { code: 'OLD', validUntil: new Date('2026-01-01T00:00:00Z') },
      { code: 'PROONLY', appliesTo: ['pro'] },
      { code: 'TWOFREE', kind: 'free_months', percentOff: null, freeMonths: 2 },
    ]);
    const quote = await checkCoupon(ctx, { code: ' welcome20 ', plan: 'growth', cycle: 'monthly' }, NOW);
    assert.deepEqual([quote.code, quote.discountMinor, quote.description.en], ['WELCOME20', 5_980, '20% off']);
    assert.equal((await checkCoupon(ctx, { code: 'WELCOME20', plan: 'growth', cycle: 'annual' }, NOW)).discountMinor, 59_800, 'on the annual price');
    await assert.rejects(() => checkCoupon(ctx, { code: 'NOPE', plan: 'growth', cycle: 'monthly' }, NOW), refused(/not valid/));
    await assert.rejects(() => checkCoupon(ctx, { code: 'OLD', plan: 'growth', cycle: 'monthly' }, NOW), refused(/expired/));
    await assert.rejects(() => checkCoupon(ctx, { code: 'PROONLY', plan: 'growth', cycle: 'monthly' }, NOW), refused(/not for the Growth/));
    const free = await checkCoupon(ctx, { code: 'twofree', plan: 'starter', cycle: 'monthly' }, NOW);
    assert.deepEqual([free.discountMinor, free.freeMonths], [0, 2]);
    await assert.rejects(() => checkCoupon(ctx, { code: 'X', plan: 'enterprise', cycle: 'monthly' }, NOW), (e: any) => e.code === 'validation_failed');

    for (let i = 0; i < 20; i++) await checkCoupon(ctx, { code: 'NOPE', plan: 'growth', cycle: 'monthly' }, NOW).catch(() => null);
    await assert.rejects(() => checkCoupon(ctx, { code: 'WELCOME20', plan: 'growth', cycle: 'monthly' }, NOW), (e: any) => e.code === 'rate_limited', 'codes cannot be guessed at speed');
  } finally { await harness.close(); }
});

test('redemption: once per store, never past the limit — even when two stores take the last use at once', async () => {
  setRateLimiter(new MemoryRateLimiter());
  const harness = await createTestDb();
  try {
    const alpha = await store(harness, 'alpha');
    const bravo = await store(harness, 'bravo');
    const charlie = await store(harness, 'charlie');
    await plant(harness, [{ code: 'TWICE', maxRedemptions: 2 }]);
    const redeem = (ctx: any) => redeemCoupon(ctx, { code: 'TWICE', plan: 'growth', cycle: 'monthly', discountMinor: 5_980 }, NOW);

    await redeem(alpha.ctx);
    await assert.rejects(() => redeem(alpha.ctx), (e: any) => e.code === 'conflict' && /already used/.test(e.message));
    await assert.rejects(() => checkCoupon(alpha.ctx, { code: 'TWICE', plan: 'growth', cycle: 'monthly' }, NOW), refused(/already used/));

    const results = await Promise.allSettled([redeem(bravo.ctx), redeem(charlie.ctx)]);
    assert.deepEqual(results.map((r) => r.status).sort(), ['fulfilled', 'rejected'], 'one of the two gets the last use');
    const rows = await harness.asAdmin(() => harness.db.select().from(couponRedemptions));
    assert.equal(rows.length, 2);

    // Each store sees only its own redemption.
    const seen: any = await withTenant(alpha.tenantId, (db) => db.find(couponRedemptions));
    assert.equal(seen.length, 1);
  } finally { await harness.close(); }
});

test('the catalogue is read-only to the app role', async () => {
  const harness = await createTestDb();
  try {
    await plant(harness, [{ code: 'READ' }]);
    const denied = (e: any) => { for (let x = e; x; x = x.cause) if (/permission denied/.test(String(x.message))) return true; return false; };
    await assert.rejects(() => appDb().execute(sql`update coupons set percent_off = 100`), denied);
    await assert.rejects(() => appDb().execute(sql`insert into coupons (id, code, kind) values (gen_random_uuid(), 'MINE', 'percent')`), denied);
    const rows: any = await appDb().execute(sql`select code from coupons`);
    assert.equal((Array.isArray(rows) ? rows : rows.rows).length, 1, 'but it can read it');
  } finally { await harness.close(); }
});
