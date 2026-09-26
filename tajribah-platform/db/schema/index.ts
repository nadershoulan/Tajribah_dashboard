/**
 * The schema, plus the registry the isolation suite walks.
 *
 * Nothing here is hand-maintained: `TENANT_TABLES` is derived from the schema by looking
 * for a `tenant_id` column. Add a tenant-scoped table and it is covered automatically; add
 * one *without* a tenant column and `EXEMPT` forces you to say why, in writing, or the
 * suite fails.
 *
 * The same list drives the RLS migration: every table here gets `ENABLE` + `FORCE ROW LEVEL
 * SECURITY` and a `tenant_isolation` policy, generated rather than typed out, so a new table
 * cannot be left unprotected by forgetting a migration line. See docs/ARCHITECTURE.md.
 */
import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';

import * as identity from './identity';
import * as billing from './billing';
import * as commerce from './commerce';
import * as ar from './ar';
import * as ops from './ops';
import * as analytics from './analytics';

export * from './identity';
export * from './billing';
export * from './commerce';
export * from './ar';
export * from './ops';
export * from './analytics';

const modules = { ...identity, ...billing, ...commerce, ...ar, ...ops, ...analytics };

// `unknown[]` first: the union of every export is too wide for a type predicate to narrow.
const exported: unknown[] = Object.values(modules);

export const ALL_TABLES: PgTable[] = exported.filter(
  (value): value is PgTable => is(value, PgTable),
);

export const tableName = (table: PgTable): string => getTableName(table);

export function tenantColumnOf(table: PgTable): string | null {
  const columns = getTableColumns(table) as Record<string, { name: string }>;
  const match = Object.entries(columns).find(([, column]) => column.name === 'tenant_id');
  return match ? match[0] : null;
}

/** Every table carrying a `tenant_id`. Read and write of these goes through `TenantDb` only. */
export const TENANT_TABLES: PgTable[] = ALL_TABLES.filter((t) => tenantColumnOf(t) !== null);

/**
 * Tables with no tenant column, each with the reason it is allowed to have none.
 * A table that is in neither list fails the isolation suite — the decision cannot be
 * skipped by forgetting.
 */
export const EXEMPT: Record<string, string> = {
  tenants: 'The tenant row itself — keyed by `id`. Scoped by `TenantDb` against `id`, not `tenant_id`.',
  users: 'Global by design (§7.3): one person can belong to several stores. Tenancy lives in tenant_memberships, and access is checked at the API layer. This is the documented exception.',
  refresh_tokens: 'Belongs to a session, which belongs to a user rather than a store; a session spans every tenant the user can switch between.',
  verification_tokens: 'Belongs to a user (email verification, password reset, phone OTP), which exists before and independently of any tenant.',
  plans: 'Platform plan catalogue, identical for every tenant and read-only to merchants; a tenant column would imply per-tenant pricing rows that do not exist.',
  plan_limits: 'Quota values belonging to a plan, not to a tenant. A tenant reaches them through its subscription, and changing one changes it for every tenant on that plan.',
  plan_features: 'Feature switches belonging to a plan, not to a tenant. Per-tenant overrides live in feature_flags instead.',
  billing_events: 'Raw provider webhook envelopes, deduplicated before a tenant is known. Resolved to a tenant during processing.',
  model_registry: 'Catalogue of AI models, versions and A/B splits operated by Tajribah. It holds no tenant data and is never written by a merchant.',
  coupons: 'Platform catalogue of discount codes (P2.12), the same for every store and written only by the admin console. Which store used which code is tenant data, in coupon_redemptions.',
};

/**
 * Tables that carry a `tenant_id` but deliberately have **no RLS policy**.
 *
 * These are platform infrastructure: a worker has to claim jobs across every tenant at
 * once, and a policy would make that impossible rather than safe. The tenant column is
 * still there — it drives queue fairness and the progress a merchant sees — and any
 * request-path read of them still goes through `TenantDb`.
 *
 * This list is short on purpose. Adding to it removes a guarantee, so each entry says who
 * reads the table and why a policy cannot serve them.
 */
export const RLS_EXEMPT: Record<string, string> = {
  jobs: 'The worker claims across all tenants in one statement (FOR UPDATE SKIP LOCKED with per-tenant fairness); a policy would hide every row from it. Merchant-facing reads of job progress go through TenantDb.',
  feature_flags: 'Platform configuration. A row with a NULL tenant is the default for everyone, so a policy comparing tenant_id would hide exactly the rows that matter.',
};

/**
 * Tables the application role may add to and read, never change or remove — with the
 * reason. The RLS generator grants `tajribah_app` only SELECT and INSERT on these; the
 * isolation suite expects UPDATE and DELETE to be refused outright.
 */
export const APPEND_ONLY: Record<string, string> = {
  audit_logs: 'The record of who changed what. A trail the application can rewrite proves nothing: a compromised session, or a bug, could remove the evidence of itself. Erasure (PDPL) and retention run as tajribah_admin.',
  credit_ledger: 'AI credits (§7.4 rule 1, P2.9): the balance is the sum of the deltas, so a row changed or removed afterwards silently changes what a store has. Corrections are new rows (`adjustment`), never edits.',
};

/**
 * Tables whose `tenant_id` is nullable, with the reason. A NULL means "platform-wide", and
 * every query against these must still filter by tenant when acting for one.
 */
export const NULLABLE_TENANT: Record<string, string> = {
  jobs: 'Platform jobs (rollups, cleanup) have no tenant; tenant jobs always set it.',
  sessions: 'A session exists before a tenant is chosen, and the switcher changes it.',
  feature_flags: 'A NULL row is the platform default; a tenant row overrides it.',
};
