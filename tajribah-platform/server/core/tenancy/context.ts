/**
 * P0.5 — the tenant context.
 *
 * Nothing constructs a `TenantContext` from a request parameter. It is built from a
 * verified session plus a membership row that was read from the database: the tenant a
 * caller may act for is a fact about the database, never a claim in the request.
 *
 * Every service takes the context. Every log line carries `tenantId` and `requestId`. Every
 * query goes through `ctx.db`, which is already scoped.
 */
import { and, eq } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { subscriptions, tenantMemberships, tenants, type Tenant } from '@/db/schema';
import type { MemberRole } from '@/lib/permissions';
import { allowedWhileReadOnly, writeStateOf, type ReadOnlyReason } from '../billing/lifecycle';
import { errors } from '../errors/problem';
import { PERMISSIONS } from '@/lib/permissions';
import { permissionsFor, requirePermission, type Permission } from '../rbac/permissions';
import { TenantDb } from './tenant-db';

export type Actor = {
  userId: string;
  email: string;
  isStaff: boolean;
};

export type TenantContext = {
  tenantId: string;
  tenant: Tenant;
  actor: Actor;
  /** `system` only for background work (`systemContext`): no member is acting. */
  role: MemberRole | 'system';
  /** Set on a `systemContext`; the audit trail records such changes as the platform's. */
  actorType?: 'system' | 'staff';
  permissions: Set<Permission>;
  requestId: string;
  db: TenantDb;
  /**
   * P2.11: why this store cannot change things right now (trial or subscription ended), or
   * null. While set, `require` refuses every write permission but the ones that lead out of it.
   */
  readOnly: ReadOnlyReason | null;
  /** Throws 403 if the role lacks it (402 if the store is read-only). Call it at the top of every mutating service method. */
  require(permission: Permission): void;
  can(permission: Permission): boolean;
};

/**
 * Resolve the context for `actor` acting on `tenantId`.
 *
 * A user who is not an active member gets `not_found`, not `forbidden` — from outside, a
 * tenant they do not belong to must be indistinguishable from one that does not exist.
 */
export async function buildTenantContext(input: {
  actor: Actor;
  tenantId: string;
  requestId: string;
}): Promise<TenantContext> {
  const db = unsafeAdminDb(); // membership lookup: the one read that precedes a tenant scope
  const [membership] = await db
    .select()
    .from(tenantMemberships)
    .where(and(
      eq(tenantMemberships.tenantId, input.tenantId),
      eq(tenantMemberships.userId, input.actor.userId),
      eq(tenantMemberships.status, 'active'),
    ))
    .limit(1);

  if (!membership) throw errors.notFound('tenant');

  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
  if (!tenant || tenant.deletedAt) throw errors.notFound('tenant');
  if (tenant.status === 'suspended') {
    throw errors.forbidden('this store is suspended — billing or compliance hold');
  }

  const permissions = permissionsFor(membership.role);
  const scoped = TenantDb.for(tenant.id);
  // P2.11: one small read per request — every write in the product passes `require`, so this
  // is where a lapsed store becomes read-only, not in each feature that remembers to check.
  const [subscription] = await db.select({ status: subscriptions.status }).from(subscriptions)
    .where(eq(subscriptions.tenantId, tenant.id)).limit(1);
  const { readOnly } = writeStateOf({ subscriptionStatus: subscription?.status ?? null, trialEndsAt: tenant.trialEndsAt });
  const blocked = (permission: Permission) => readOnly !== null && !allowedWhileReadOnly(permission);

  return {
    tenantId: tenant.id,
    tenant,
    actor: input.actor,
    role: membership.role,
    permissions,
    requestId: input.requestId,
    db: scoped,
    readOnly,
    require: (permission) => {
      requirePermission(permissions, permission);
      if (blocked(permission)) throw errors.readOnly(readOnly!);
    },
    can: (permission) => permissions.has(permission) && !blocked(permission),
  };
}

/** A4b: what a staff view may do — read, and nothing else. */
const STAFF_VIEW: ReadonlySet<Permission> = new Set(PERMISSIONS.filter((p) => p.endsWith(':read')));

/**
 * A4b — a staff member viewing a store's dashboard. No membership: the right comes from the
 * session (set by the staff console, time-limited) and from being staff, re-read on every
 * request — removing staff status ends the view at once. Reads only: every write permission is
 * refused, whatever the screen asks. A suspended store can be viewed (that is often why).
 */
export async function buildStaffViewContext(input: { actor: Actor; tenantId: string; requestId: string }): Promise<TenantContext> {
  if (!input.actor.isStaff) throw errors.notFound('tenant');
  const [tenant] = await unsafeAdminDb().select().from(tenants).where(eq(tenants.id, input.tenantId)).limit(1);
  if (!tenant || tenant.deletedAt) throw errors.notFound('tenant');
  const permissions = new Set(STAFF_VIEW);
  return {
    tenantId: tenant.id, tenant, actor: input.actor, role: 'system', actorType: 'staff', permissions,
    requestId: input.requestId, db: TenantDb.for(tenant.id), readOnly: null,
    require: (permission) => {
      if (!permissions.has(permission)) throw errors.forbidden('this is a read-only staff view of the store');
    },
    can: (permission) => permissions.has(permission),
  };
}

/**
 * The context for background work on one tenant — a sync job, a webhook handler. There is
 * no session and no membership, so nothing is inherited: the caller names the tenant (from
 * the job row, which only tenant-scoped code could have written) and the exact permissions
 * the job needs. Changes land in the audit trail as `system`. A suspended or deleted tenant
 * is refused, as it would be for a person — except `evenIfSuspended` (P1.15): taking a suspended
 * store's buttons off its shop is the one job that must run *because* it is suspended.
 */
export async function systemContext(input: {
  tenantId: string;
  requestId: string;
  permissions: readonly Permission[];
  evenIfSuspended?: boolean;
}): Promise<TenantContext> {
  const scoped = TenantDb.for(input.tenantId);
  const tenant = await scoped.findById(tenants, input.tenantId);
  if (!tenant || tenant.deletedAt) throw errors.notFound('tenant');
  if (tenant.status === 'suspended' && !input.evenIfSuspended) throw errors.forbidden('this store is suspended — background work is paused');
  const permissions = new Set(input.permissions);
  return {
    tenantId: tenant.id,
    tenant,
    actor: { userId: 'system', email: 'system', isStaff: false },
    role: 'system',
    actorType: 'system',
    permissions,
    requestId: input.requestId,
    db: scoped,
    // Housekeeping (draft expiry, key re-seal, an uninstall webhook) must still run on a
    // read-only store; which background work to stop for one is the schedule's decision.
    readOnly: null,
    require: (permission) => requirePermission(permissions, permission),
    can: (permission) => permissions.has(permission),
  };
}

/** Every store the user can switch between, for the tenant switcher (§P1 dashboard shell). */
/** A4b: the store a staff view points at, for `/me` — null if it no longer exists. */
export async function staffViewedStore(tenantId: string): Promise<Tenant | null> {
  const [tenant] = await unsafeAdminDb().select().from(tenants).where(eq(tenants.id, tenantId)).limit(1);
  return tenant && !tenant.deletedAt ? tenant : null;
}

export async function membershipsOf(userId: string): Promise<{ tenant: Tenant; role: MemberRole }[]> {
  const db = unsafeAdminDb();
  const rows = await db
    .select({ tenant: tenants, role: tenantMemberships.role })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.status, 'active')));
  return rows.filter((r) => !r.tenant.deletedAt);
}
