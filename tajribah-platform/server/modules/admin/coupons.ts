/**
 * A13 — coupons, for staff (ADM-15): the catalogue P2.12 checks at checkout.
 *
 * Rules:
 *  - A code is what a merchant types, normalised as the checkout normalises it (`normaliseCode`),
 *    letters, digits, `-` and `_`, unique.
 *  - The value fits its kind: a percent 1–100, a fixed amount above zero, 1–12 free months.
 *  - **Once a store has used a coupon, its code, kind and value are fixed**: the record keeps
 *    what stores actually got. Its dates, limit, plans, note and on/off can still change.
 *  - A limit never drops below the uses already made. There is no delete (redemptions point at
 *    the row); a coupon is switched off.
 *  - Every change carries a reason and lands in the staff trail with before and after, in the
 *    same transaction.
 */
import { count, desc, eq, inArray } from 'drizzle-orm';
import { unsafeAdminDb, type Db } from '@/db/client';
import { PLAN_CODE, couponRedemptions, coupons, type Coupon } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { errors } from '@/server/core/errors/problem';
import { normaliseCode } from '@/server/modules/billing/coupons';
import { staffLog, type StaffContext } from './access';

type Plan = (typeof PLAN_CODE)[number];
export type CouponFields = {
  code: string; kind: Coupon['kind']; percentOff: number | null; amountOffMinor: number | null; freeMonths: number | null;
  appliesTo: Plan[] | null; maxRedemptions: number | null; validFrom: string | null; validUntil: string | null; active: boolean; note: string | null;
};
export type AdminCoupon = CouponFields & { id: string; redemptions: number; createdAt: string };

const LOCKED = ['code', 'kind', 'percentOff', 'amountOffMinor', 'freeMonths'] as const;

function view(c: Coupon, redemptions: number): AdminCoupon {
  return {
    id: c.id, code: c.code, kind: c.kind, percentOff: c.percentOff, amountOffMinor: c.amountOffMinor, freeMonths: c.freeMonths,
    appliesTo: c.appliesTo ?? null, maxRedemptions: c.maxRedemptions, validFrom: c.validFrom?.toISOString() ?? null,
    validUntil: c.validUntil?.toISOString() ?? null, active: c.active, note: c.note, redemptions, createdAt: c.createdAt.toISOString(),
  };
}

/** ADM-15 — every coupon, newest first, with how many stores have used it. */
export async function listCoupons(): Promise<AdminCoupon[]> {
  const db = unsafeAdminDb(); // the catalogue is platform data, read-only to the app role
  const rows = await db.select().from(coupons).orderBy(desc(coupons.id)).limit(500);
  const used = rows.length
    ? await db.select({ id: couponRedemptions.couponId, n: count() }).from(couponRedemptions).where(inArray(couponRedemptions.couponId, rows.map((r) => r.id))).groupBy(couponRedemptions.couponId)
    : [];
  const n = new Map(used.map((u) => [u.id, Number(u.n)]));
  return rows.map((c) => view(c, n.get(c.id) ?? 0));
}

/** Everything wrong with a coupon as it would be saved, by field; empty when it is fine. */
function problems(c: CouponFields, redemptions: number): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!/^[A-Z0-9_-]{3,32}$/.test(c.code)) out.code = ['3 to 32 letters, digits, - or _'];
  const whole = (v: number | null, min: number, max: number) => v !== null && Number.isInteger(v) && v >= min && v <= max;
  if (c.kind === 'percent' && !whole(c.percentOff, 1, 100)) out.percentOff = ['1 to 100'];
  if (c.kind === 'fixed' && !whole(c.amountOffMinor, 1, 100_000_000)) out.amountOffMinor = ['a whole number of halalas above 0'];
  if (c.kind === 'free_months' && !whole(c.freeMonths, 1, 12)) out.freeMonths = ['1 to 12 months'];
  // Only the value of its own kind is kept: a percent coupon has no amount, and so on.
  const stray = (c.kind !== 'percent' && c.percentOff !== null) || (c.kind !== 'fixed' && c.amountOffMinor !== null) || (c.kind !== 'free_months' && c.freeMonths !== null);
  if (stray) out.kind = ['only the value of its own kind'];
  if (c.appliesTo !== null && (c.appliesTo.length === 0 || c.appliesTo.some((p) => !(PLAN_CODE as readonly string[]).includes(p)))) out.appliesTo = ['one or more plans, or all'];
  if (c.maxRedemptions !== null && (!Number.isInteger(c.maxRedemptions) || c.maxRedemptions < Math.max(1, redemptions))) {
    out.maxRedemptions = [redemptions ? `at least the ${redemptions} uses already made` : 'at least 1, or no limit'];
  }
  const from = c.validFrom ? Date.parse(c.validFrom) : null;
  const until = c.validUntil ? Date.parse(c.validUntil) : null;
  if (Number.isNaN(from) || Number.isNaN(until)) out.validFrom = ['a date'];
  else if (from !== null && until !== null && from >= until) out.validUntil = ['after the start'];
  if (c.note && c.note.length > 500) out.note = ['500 characters at most'];
  return out;
}

const row = (c: CouponFields) => ({
  code: c.code, kind: c.kind, percentOff: c.percentOff, amountOffMinor: c.amountOffMinor, freeMonths: c.freeMonths,
  appliesTo: c.appliesTo, maxRedemptions: c.maxRedemptions, validFrom: c.validFrom ? new Date(c.validFrom) : null,
  validUntil: c.validUntil ? new Date(c.validUntil) : null, active: c.active, note: c.note?.trim() || null,
});

function needReason(reason: string): string {
  const r = reason.trim();
  if (r.length < 5) throw errors.validation({ reason: ['say why, in a few words'] });
  return r;
}

export async function createCoupon(staff: StaffContext, input: CouponFields & { reason: string }): Promise<AdminCoupon> {
  const reason = needReason(input.reason);
  const fields: CouponFields = { ...input, code: normaliseCode(input.code) };
  const bad = problems(fields, 0);
  if (Object.keys(bad).length) throw errors.validation(bad);
  return unsafeAdminDb().transaction(async (tx) => {
    const [taken] = await tx.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, fields.code)).limit(1);
    if (taken) throw errors.conflict('a coupon with this code already exists');
    const [created] = await tx.insert(coupons).values({ id: uuidv7(), ...row(fields) }).returning();
    await staffLog(staff, { action: 'coupon.create', targetType: 'coupon', targetId: created!.id, reason, detail: { after: view(created!, 0) } }, tx as unknown as Db);
    return view(created!, 0);
  });
}

export async function updateCoupon(staff: StaffContext, id: string, patch: Partial<CouponFields> & { reason: string }): Promise<AdminCoupon> {
  const reason = needReason(patch.reason);
  return unsafeAdminDb().transaction(async (tx) => {
    const [coupon] = await tx.select().from(coupons).where(eq(coupons.id, id)).for('update');
    if (!coupon) throw errors.notFound('coupon');
    const [{ n }] = await tx.select({ n: count() }).from(couponRedemptions).where(eq(couponRedemptions.couponId, id));
    const redemptions = Number(n);
    const before = view(coupon, redemptions);
    const { reason: _reason, ...changes } = patch;
    void _reason;
    const after: CouponFields = { ...before, ...changes, code: changes.code !== undefined ? normaliseCode(changes.code) : before.code };
    const changed = (Object.keys(after) as (keyof CouponFields)[]).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
    if (changed.length === 0) throw errors.conflict('nothing changed');
    if (redemptions > 0) {
      const locked = changed.filter((k) => (LOCKED as readonly string[]).includes(k));
      if (locked.length) throw errors.conflict(`a coupon stores have used keeps its code, kind and value (${locked.join(', ')})`);
    }
    const bad = problems(after, redemptions);
    if (Object.keys(bad).length) throw errors.validation(bad);
    if (changed.includes('code')) {
      const [taken] = await tx.select({ id: coupons.id }).from(coupons).where(eq(coupons.code, after.code)).limit(1);
      if (taken) throw errors.conflict('a coupon with this code already exists');
    }
    const [saved] = await tx.update(coupons).set({ ...row(after), updatedAt: new Date() }).where(eq(coupons.id, id)).returning();
    const diff = Object.fromEntries(changed.map((k) => [k, { from: before[k], to: after[k] }]));
    await staffLog(staff, { action: 'coupon.update', targetType: 'coupon', targetId: id, reason, detail: { code: before.code, changes: diff } }, tx as unknown as Db);
    return view(saved!, redemptions);
  });
}
