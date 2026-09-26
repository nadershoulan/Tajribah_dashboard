/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A13 — staff manage coupons: the checkout honours what they create, the value fits its kind,
 * a used coupon keeps its code, kind and value, a limit never drops below the uses made, every
 * change is in the staff trail with a reason.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { couponRedemptions, staffAudit } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import type { StaffContext } from '@/server/modules/admin/access';
import { createCoupon, listCoupons, updateCoupon, type CouponFields } from '@/server/modules/admin/coupons';
import { checkCoupon } from '@/server/modules/billing/coupons';

setLogLevel('error');
const STAFF = (id: string): StaffContext => ({ userId: id, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'r' });
const BASE: CouponFields = {
  code: 'launch20', kind: 'percent', percentOff: 20, amountOffMinor: null, freeMonths: null, appliesTo: null,
  maxRedemptions: null, validFrom: null, validUntil: null, active: true, note: null,
};

test('create: normalised code, the checkout honours it at once, unique, the value fits its kind, dates in order', async () => {
  setRateLimiter(new MemoryRateLimiter());
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const staff = STAFF(store.userId);
    const created = await createCoupon(staff, { ...BASE, code: ' launch 20 ', appliesTo: ['growth'], reason: 'October launch campaign' });
    assert.equal(created.code, 'LAUNCH20');
    const merchant = await buildTenantContext({ actor: { userId: store.userId, email: store.email, isStaff: false }, tenantId: store.tenantId, requestId: 'r' });
    const check = await checkCoupon(merchant, { code: 'launch20', plan: 'growth', cycle: 'monthly' });
    assert.equal(check.discountMinor, 5980, '20% of SAR 299 at the checkout');

    await assert.rejects(() => createCoupon(staff, { ...BASE, code: 'LAUNCH20', reason: 'same code again' }), (e: any) => e.code === 'conflict');
    const invalid = (fields: Partial<CouponFields>) => assert.rejects(() => createCoupon(staff, { ...BASE, code: `X${uuidv7().slice(0, 6)}`, ...fields, reason: 'invalid input test' }), (e: any) => e.code === 'validation_failed');
    await invalid({ code: 'AB' });
    await invalid({ code: 'NO!PE' });
    await invalid({ percentOff: 0 });
    await invalid({ percentOff: 101 });
    await invalid({ kind: 'fixed', percentOff: null, amountOffMinor: 0 });
    await invalid({ kind: 'free_months', percentOff: null, freeMonths: 13 });
    await invalid({ amountOffMinor: 500 }); // a percent coupon carrying an amount too
    await invalid({ appliesTo: [] });
    await invalid({ maxRedemptions: 0 });
    await invalid({ validFrom: '2026-10-10T00:00:00Z', validUntil: '2026-10-01T00:00:00Z' });
    await assert.rejects(() => createCoupon(staff, { ...BASE, code: 'OTHER1', reason: 'no' }), (e: any) => e.code === 'validation_failed', 'a reason');

    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit));
    assert.deepEqual(trail.map((r) => [r.action, r.reason]), [['coupon.create', 'October launch campaign']], 'refusals log nothing');
  } finally { await harness.close(); }
});

test('edit: switched off at once at checkout; once used, code / kind / value stay, the limit stays at or above the uses', async () => {
  setRateLimiter(new MemoryRateLimiter());
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const staff = STAFF(store.userId);
    const coupon = await createCoupon(staff, { ...BASE, maxRedemptions: 5, reason: 'campaign start' });

    // Before anyone uses it, everything can change.
    const edited = await updateCoupon(staff, coupon.id, { percentOff: 25, code: 'launch25', reason: 'marketing changed the offer' });
    assert.deepEqual([edited.code, edited.percentOff], ['LAUNCH25', 25]);

    await harness.asAdmin(() => harness.db.insert(couponRedemptions).values([
      { tenantId: store.tenantId, couponId: coupon.id, discountMinor: 100 },
    ] as any));
    await assert.rejects(() => updateCoupon(staff, coupon.id, { percentOff: 50, reason: 'bigger discount now' }), (e: any) => e.code === 'conflict' && /keeps its code, kind and value/.test(e.message));
    await assert.rejects(() => updateCoupon(staff, coupon.id, { code: 'NEWCODE', reason: 'rename after use' }), (e: any) => e.code === 'conflict');
    await assert.rejects(() => updateCoupon(staff, coupon.id, { maxRedemptions: 0, reason: 'below the uses made' }), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => updateCoupon(staff, coupon.id, { note: null, reason: 'nothing at all' }), (e: any) => e.code === 'conflict', 'nothing changed');
    const limited = await updateCoupon(staff, coupon.id, { maxRedemptions: 1, validUntil: '2026-12-31T21:00:00Z', reason: 'close it after this one' });
    assert.deepEqual([limited.maxRedemptions, limited.redemptions], [1, 1]);

    const off = await updateCoupon(staff, coupon.id, { active: false, reason: 'campaign over' });
    assert.equal(off.active, false);
    const other = await seedTenant(harness, 'bravo');
    const merchant = await buildTenantContext({ actor: { userId: other.userId, email: other.email, isStaff: false }, tenantId: other.tenantId, requestId: 'r' });
    await assert.rejects(() => checkCoupon(merchant, { code: 'LAUNCH25', plan: 'growth', cycle: 'monthly' }), (e: any) => e.code === 'validation_failed', 'the checkout refuses it at once');

    const listed = await listCoupons();
    assert.deepEqual(listed.map((c) => [c.code, c.redemptions, c.active]), [['LAUNCH25', 1, false]]);
    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit));
    assert.deepEqual(trail.map((r) => r.action), ['coupon.create', 'coupon.update', 'coupon.update', 'coupon.update']);
    assert.deepEqual((trail[1]!.detail as any).changes.percentOff, { from: 20, to: 25 });
    await assert.rejects(() => updateCoupon(staff, uuidv7(), { active: true, reason: 'no such coupon' }), (e: any) => e.code === 'not_found');

    // Two stores have used it: a limit of 1 would pretend one of them did not.
    const twice = await createCoupon(staff, { ...BASE, code: 'TWICE', reason: 'limit test coupon' });
    await harness.asAdmin(() => harness.db.insert(couponRedemptions).values([
      { tenantId: store.tenantId, couponId: twice.id, discountMinor: 1 }, { tenantId: other.tenantId, couponId: twice.id, discountMinor: 1 },
    ] as any));
    await assert.rejects(() => updateCoupon(staff, twice.id, { maxRedemptions: 1, reason: 'cap below the uses' }), (e: any) => e.code === 'validation_failed');
    assert.equal((await updateCoupon(staff, twice.id, { maxRedemptions: 2, reason: 'cap at the uses made' })).maxRedemptions, 2);
  } finally { await harness.close(); }
});
