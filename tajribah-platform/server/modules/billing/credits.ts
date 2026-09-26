/**
 * P2.9 — AI credits: an append-only ledger (§7.4 rule 1).
 *
 * Rules that are not style choices:
 *  - **The balance is the sum of the deltas.** `balance_after` is written in the same
 *    transaction, under a lock on the store's row, so it is the running sum — a convenience,
 *    never the authority. The app role cannot update or delete a row (APPEND_ONLY); a correction
 *    is a new `adjustment` row.
 *  - **Every row has a reference** (an AI job, a payment, a period's grant). The service checks
 *    first under the lock, and a unique index (drizzle/0009) makes a second row impossible:
 *    a retried job is charged once, a grant is made once per period, a refund happens once.
 *  - **Two buckets.** The plan grants its monthly credits at the start of each Riyadh month
 *    and they expire at its end; credits bought never expire. Spending takes the plan's first.
 *    The unused part of a period's grant is expired — as a row — when the next grant is made.
 *  - **Never below zero.** Spending more than the balance is refused, naming both numbers.
 *    An unlimited plan (Enterprise) records its use with delta 0, so the history is complete.
 */
import { and, desc, eq, gte, lt } from 'drizzle-orm';
import { creditLedger, tenants } from '@/db/schema';
import { stableUuid, uuidv7 } from '@/lib/ids';
import { UNLIMITED } from '@/lib/plans';
import { record } from '@/server/core/audit/audit';
import { creditsUsedIn, currentPeriodStart, entitlementsOf, nextPeriodStart } from '@/server/core/billing/entitlements';
import { errors } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';
import { withTenant } from '@/server/core/tenancy/rls';

export type CreditReason = 'purchase' | 'plan_grant' | 'consumption' | 'refund' | 'adjustment' | 'expiry';
export type CreditReference = { type: string; id: string };
type Entry = typeof creditLedger.$inferSelect;

const balanceOf = (db: TenantDb) => db.sum(creditLedger, creditLedger.delta);

async function existing(db: TenantDb, ref: CreditReference): Promise<Entry | null> {
  return db.findOne(creditLedger, and(eq(creditLedger.referenceType, ref.type), eq(creditLedger.referenceId, ref.id)));
}

/** Append one row with its running balance, timed `at`. The caller holds the store lock. */
async function append(db: TenantDb, at: Date, entry: { delta: number; reason: CreditReason; ref: CreditReference; note?: string | null }): Promise<Entry> {
  const balance = await balanceOf(db);
  return db.insert(creditLedger, {
    id: uuidv7(at.getTime()), delta: entry.delta, balanceAfter: balance + entry.delta, reason: entry.reason,
    referenceType: entry.ref.type, referenceId: entry.ref.id, note: entry.note ?? null, createdAt: at,
  } as never);
}

/**
 * The plan's grant for the period `now` falls in, made once. Before it, the previous grant's
 * unused part is expired (a row, referenced to that grant, so it too happens once).
 */
async function ensurePeriodGrant(ctx: TenantContext, db: TenantDb, now: Date, limit: number): Promise<void> {
  const period = currentPeriodStart(now);
  const ref = { type: 'plan_grant', id: await stableUuid('plan_grant', ctx.tenantId, period.toISOString()) };
  if (await existing(db, ref)) return;

  const [previous] = await db.find(creditLedger, and(eq(creditLedger.reason, 'plan_grant'), lt(creditLedger.createdAt, period)),
    { limit: 1, orderBy: desc(creditLedger.createdAt) });
  if (previous) {
    const expiryRef = { type: 'plan_expiry', id: previous.referenceId! };
    if (!(await existing(db, expiryRef))) {
      const from = currentPeriodStart(previous.createdAt);
      const unused = Math.max(0, previous.delta - (await creditsUsedIn(db, from, nextPeriodStart(previous.createdAt))));
      const expire = Math.min(unused, await balanceOf(db));
      // Dated the last instant of the month it belongs to, so the ledger reads in order.
      if (expire > 0) await append(db, new Date(period.getTime() - 1), { delta: -expire, reason: 'expiry', ref: expiryRef, note: 'unused plan credits at the end of the month' });
    }
  }

  if (limit > 0) await append(db, period, { delta: limit, reason: 'plan_grant', ref, note: `${limit} credits for the month` });
}

/**
 * Every ledger write: the store row locked (writes queue per store), the period's grant in
 * place. The plan's limit is read before the transaction: the catalogue is platform state on
 * another handle, and reading it inside would hold two connections at once.
 */
async function locked<T>(ctx: TenantContext, now: Date, fn: (db: TenantDb, limit: number) => Promise<T>): Promise<T> {
  const limit = (await entitlementsOf(ctx)).limit('ai_credits');
  return withTenant(ctx.tenantId, async (db) => {
    await db.lockById(tenants, ctx.tenantId);
    await ensurePeriodGrant(ctx, db, now, limit);
    return fn(db, limit);
  });
}

/**
 * Spend credits for an AI job. The same job again is the same row (charged once). The caller's
 * module checks its own permission (starting a generation needs `models:write`).
 */
export async function consumeCredits(ctx: TenantContext, credits: number, job: string, now = new Date()): Promise<Entry> {
  if (!Number.isInteger(credits) || credits < 1) throw errors.validation({ credits: ['a whole number of credits, at least 1'] });
  return locked(ctx, now, async (db, limit) => {
    const ref = { type: 'ai_job', id: job };
    const done = await existing(db, ref);
    if (done) return done;
    if (limit === UNLIMITED) return append(db, now, { delta: 0, reason: 'consumption', ref, note: `${credits} credits (unlimited plan)` });
    const balance = await balanceOf(db);
    if (balance < credits) throw errors.conflict(`not enough AI credits: ${balance} left, ${credits} needed`);
    return append(db, now, { delta: -credits, reason: 'consumption', ref });
  });
}

/** Give back what a failed job took — once, and only what it took. */
export async function refundCredits(ctx: TenantContext, job: string, now = new Date()): Promise<Entry | null> {
  return locked(ctx, now, async (db) => {
    const charged = await existing(db, { type: 'ai_job', id: job });
    if (!charged || charged.delta === 0) return null;
    const ref = { type: 'ai_job_refund', id: job };
    return (await existing(db, ref)) ?? append(db, now, { delta: -charged.delta, reason: 'refund', ref, note: 'the AI job failed' });
  });
}

/** Credits bought (called by the payment path, P2.5): once per payment, never expiring. */
export async function purchaseCredits(ctx: TenantContext, credits: number, payment: string, now = new Date()): Promise<Entry> {
  ctx.require('billing:write');
  if (!Number.isInteger(credits) || credits < 1) throw errors.validation({ credits: ['a whole number of credits, at least 1'] });
  return locked(ctx, now, async (db) => {
    const ref = { type: 'payment', id: payment };
    return (await existing(db, ref)) ?? append(db, now, { delta: credits, reason: 'purchase', ref });
  });
}

/** A support correction, in either direction, with the reason written down and audited. */
export async function adjustCredits(ctx: TenantContext, delta: number, note: string, now = new Date()): Promise<Entry> {
  ctx.require('billing:write');
  if (!Number.isInteger(delta) || delta === 0) throw errors.validation({ delta: ['a whole, non-zero number of credits'] });
  if (!note.trim()) throw errors.validation({ note: ['say why'] });
  return locked(ctx, now, async (db) => {
    if (delta < 0 && (await balanceOf(db)) + delta < 0) throw errors.conflict('an adjustment cannot take the balance below zero');
    const entry = await append(db, now, { delta, reason: 'adjustment', ref: { type: 'adjustment', id: uuidv7() }, note: note.trim() });
    await record(ctx, { action: 'create', resourceType: 'credit_adjustment', resourceId: entry.id, after: entry as never }, db);
    return entry;
  });
}

export type CreditSummary = {
  balance: number;
  /** Plan credits left this month (they expire at its end); the rest of the balance was bought. */
  planRemaining: number;
  grantedThisPeriod: number;
  usedThisPeriod: number;
  unlimited: boolean;
  recent: { id: string; delta: number; balanceAfter: number; reason: CreditReason; note: string | null; at: string }[];
};

/** What the store has, from the ledger (the period's grant is made first if it is due). */
export async function creditSummary(ctx: TenantContext, now = new Date()): Promise<CreditSummary> {
  ctx.require('billing:read');
  return locked(ctx, now, async (db, limit) => {
    const unlimited = limit === UNLIMITED;
    const from = currentPeriodStart(now);
    const to = nextPeriodStart(now);
    const grant = (await db.find(creditLedger, and(eq(creditLedger.reason, 'plan_grant'), gte(creditLedger.createdAt, from), lt(creditLedger.createdAt, to)), { limit: 1 }))[0];
    const used = await creditsUsedIn(db, from, to);
    const balance = await balanceOf(db);
    const granted = grant?.delta ?? 0;
    const recent = await db.find(creditLedger, undefined, { limit: 20, orderBy: [desc(creditLedger.createdAt), desc(creditLedger.id)] });
    return {
      balance,
      planRemaining: Math.min(balance, Math.max(0, granted - used)),
      grantedThisPeriod: granted,
      usedThisPeriod: used,
      unlimited,
      recent: recent.map((r) => ({ id: r.id, delta: r.delta, balanceAfter: r.balanceAfter, reason: r.reason, note: r.note, at: r.createdAt.toISOString() })),
    };
  });
}

