/**
 * P0.11 — audit logging.
 *
 * Every mutating action writes exactly one row: who, what, which resource, what changed,
 * and the request that caused it. This is what answers "who turned AR off for this product
 * last Tuesday" without a database console.
 *
 * The diff stores only the fields that actually changed, and never a secret: token,
 * password and key fields are dropped before the row is written, not redacted after.
 *
 * Services change tenant data through `auditedInsert` / `auditedUpdate` / `auditedDelete`,
 * never through `ctx.db` directly (a test in `__tests__/audit.test.ts` scans
 * `server/modules` for that). Each runs the change and its audit row in **one** `withTenant`
 * transaction, so there is no change without a row and no row without a change.
 */
import { desc, eq } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { auditLogs } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import type { TenantContext } from '../tenancy/context';
import type { TenantDb } from '../tenancy/tenant-db';
import { withTenant } from '../tenancy/rls';
import { log } from '../observability/log';
import { currentScope } from '../observability/scope';

const SECRET_FIELD = /(password|token|secret|key_hash|hash|otp|cvv)/i;

export type AuditAction =
  | 'create' | 'update' | 'delete' | 'publish' | 'unpublish'
  | 'connect' | 'disconnect' | 'sync' | 'invite' | 'role_change'
  | 'login' | 'logout' | 'plan_change' | 'export' | 'erase';

export type AuditInput = {
  action: AuditAction;
  resourceType: string;
  resourceId?: string | null;
  before?: Record<string, unknown> | null;
  after?: Record<string, unknown> | null;
  actorType?: 'user' | 'system' | 'staff' | 'api_key' | 'webhook';
};

/**
 * Only what changed, with secrets and noise removed. `updated_at` is excluded because it
 * changes on every write and would make every diff look bigger than it is.
 */
export function diff(
  before: Record<string, unknown> | null | undefined,
  after: Record<string, unknown> | null | undefined,
): { before: Record<string, unknown>; after: Record<string, unknown> } {
  const from: Record<string, unknown> = {};
  const to: Record<string, unknown> = {};
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  for (const key of keys) {
    if (SECRET_FIELD.test(key)) continue;
    if (key === 'updatedAt' || key === 'updated_at') continue;
    const oldValue = before?.[key];
    const newValue = after?.[key];
    if (same(oldValue, newValue)) continue;
    if (before) from[key] = oldValue ?? null;
    if (after) to[key] = newValue ?? null;
  }
  return { before: from, after: to };
}

function same(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

/**
 * Write the audit row through `db` — `ctx.db`, or the transaction of the change it records.
 * Either way it is tenant-scoped, so an audit row can only land in the tenant it belongs to.
 *
 * An update that changed nothing writes nothing — a log full of empty diffs is a log
 * nobody reads.
 */
export async function record(ctx: TenantContext, input: AuditInput, db: TenantDb = ctx.db): Promise<void> {
  const changes = diff(input.before, input.after);
  const changed = Object.keys(changes.before).length + Object.keys(changes.after).length;
  if (input.action === 'update' && changed === 0) return;

  await db.insert(auditLogs, {
    id: uuidv7(),
    actorUserId: input.actorType === 'system' ? null : ctx.actor.userId,
    actorType: input.actorType ?? 'user',
    action: input.action,
    resourceType: input.resourceType,
    resourceId: input.resourceId ?? null,
    changes,
    requestId: ctx.requestId,
  } as never);

  log.info('audit', {
    tenantId: ctx.tenantId, requestId: ctx.requestId, userId: ctx.actor.userId,
    action: input.action, resourceType: input.resourceType, resourceId: input.resourceId,
  });
}

/** The activity list a merchant sees in Settings → Activity. */
export async function recentActivity(ctx: TenantContext, limit = 50) {
  return ctx.db.find(auditLogs, undefined, { limit, orderBy: desc(auditLogs.createdAt) });
}

/** Everything that happened to one resource, oldest first. */
export async function historyOf(ctx: TenantContext, resourceType: string, resourceId: string) {
  const rows = await ctx.db.find(auditLogs, eq(auditLogs.resourceId, resourceId), { limit: 200 });
  return rows.filter((row) => row.resourceType === resourceType)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
}

/**
 * Sign-in and sign-out, recorded in the trail of the store the session acts for — "who got
 * into my store, and when". There is no TenantContext at that moment (it is being created or
 * torn down), so the row is written in its own tenant transaction. A session that has not
 * chosen a store yet has no store trail to write to, and writes nothing.
 */
export async function recordSessionEvent(input: {
  action: 'login' | 'logout';
  tenantId: string | null | undefined;
  userId: string;
  sessionId: string;
}): Promise<void> {
  if (!input.tenantId) return;
  await withTenant(input.tenantId, (db) => db.insert(auditLogs, {
    id: uuidv7(),
    actorUserId: input.userId,
    actorType: 'user',
    action: input.action,
    resourceType: 'session',
    resourceId: input.sessionId,
    changes: null,
    requestId: currentScope()?.requestId ?? null,
  } as never));
}

// ----------------------------------------------------------------- audited mutations

type Row = Record<string, unknown>;
type Audited = { resourceType: string; action?: AuditAction };

/** Insert one row and record `create` (or `action`) — atomically. */
export async function auditedInsert<T extends PgTable>(
  ctx: TenantContext, table: T, values: Row, audit: Audited,
): Promise<Row> {
  return withTenant(ctx.tenantId, async (db) => {
    const row = await db.insert(table, values as never) as Row;
    await record(ctx, { action: audit.action ?? 'create', resourceType: audit.resourceType, resourceId: String(row.id), after: row }, db);
    return row;
  });
}

/** Update one row by id and record the before/after diff — atomically. No change, no row. */
export async function auditedUpdate<T extends PgTable>(
  ctx: TenantContext, table: T, id: string, patch: Row, audit: Audited,
): Promise<Row> {
  return withTenant(ctx.tenantId, async (db) => {
    const before = await db.requireById(table, id) as Row;
    const after = await db.updateById(table, id, patch as never) as Row;
    await record(ctx, { action: audit.action ?? 'update', resourceType: audit.resourceType, resourceId: id, before, after }, db);
    return after;
  });
}

/** Delete one row by id and record what it held — atomically. 404 if it is not this tenant's. */
export async function auditedDelete<T extends PgTable>(
  ctx: TenantContext, table: T, id: string, audit: Audited,
): Promise<void> {
  await withTenant(ctx.tenantId, async (db) => {
    const before = await db.requireById(table, id) as Row;
    await db.deleteById(table, id);
    await record(ctx, { action: audit.action ?? 'delete', resourceType: audit.resourceType, resourceId: id, before }, db);
  });
}
