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
import { tenantMemberships, tenants, type Tenant } from '@/db/schema';
import type { MemberRole } from '@/lib/permissions';
import { errors } from '../errors/problem';
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
  role: MemberRole;
  permissions: Set<Permission>;
  requestId: string;
  db: TenantDb;
  /** Throws 403 if the role lacks it. Call it at the top of every mutating service method. */
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

  return {
    tenantId: tenant.id,
    tenant,
    actor: input.actor,
    role: membership.role,
    permissions,
    requestId: input.requestId,
    db: scoped,
    require: (permission) => requirePermission(permissions, permission),
    can: (permission) => permissions.has(permission),
  };
}

/** Every store the user can switch between, for the tenant switcher (§P1 dashboard shell). */
export async function membershipsOf(userId: string): Promise<{ tenant: Tenant; role: MemberRole }[]> {
  const db = unsafeAdminDb();
  const rows = await db
    .select({ tenant: tenants, role: tenantMemberships.role })
    .from(tenantMemberships)
    .innerJoin(tenants, eq(tenants.id, tenantMemberships.tenantId))
    .where(and(eq(tenantMemberships.userId, userId), eq(tenantMemberships.status, 'active')));
  return rows.filter((r) => !r.tenant.deletedAt);
}
