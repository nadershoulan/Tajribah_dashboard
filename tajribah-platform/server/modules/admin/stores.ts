/**
 * A3 — every store, and one store in depth, for staff (ADM-03…07).
 *
 * The store page reuses the merchant's own functions (usage, invoices, connections, team)
 * through an **inspection context**: the store's scoped database handle with read permissions
 * only — every write permission is refused — so staff see exactly the numbers the merchant sees
 * and cannot change anything by accident. Changes are A4, each one logged. A suspended store is
 * still inspectable (the merchant's context would refuse it).
 *
 * Nothing here writes: the AI credit balance is read as the ledger's sum, not through
 * `creditSummary`, which would make the month's grant as a side effect.
 */
import { and, desc, eq, ilike, isNull, lt, or, sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { creditLedger, plans, subscriptions, tenants, type Tenant } from '@/db/schema';
import { PERMISSIONS, type Permission } from '@/lib/permissions';
import type { PlanCode } from '@/lib/plans';
import { creditsUsedIn, currentPeriodStart, currentUsage, entitlementsOf, nextPeriodStart } from '@/server/core/billing/entitlements';
import { writeStateOf, type ReadOnlyReason } from '@/server/core/billing/lifecycle';
import { errors } from '@/server/core/errors/problem';
import { requirePermission } from '@/server/core/rbac/permissions';
import type { TenantContext } from '@/server/core/tenancy/context';
import { TenantDb } from '@/server/core/tenancy/tenant-db';
import { listConnections } from '@/server/modules/connections/service';
import { listTeam } from '@/server/modules/team/service';
import { invoicesOf } from '@/server/modules/billing/invoices';
import { staffTrail, type StaffContext } from './access';

/** Read everything, change nothing: the merchant's own reads, run for staff. */
const READS: Set<Permission> = new Set(PERMISSIONS.filter((p) => p.endsWith(':read')));

function inspectionContext(tenant: Tenant, staff: StaffContext): TenantContext {
  return {
    tenantId: tenant.id, tenant, role: 'system', actorType: 'system',
    actor: { userId: staff.userId, email: staff.email, isStaff: true },
    permissions: READS, requestId: staff.requestId, db: TenantDb.for(tenant.id), readOnly: null,
    require: (permission) => requirePermission(READS, permission),
    can: (permission) => READS.has(permission),
  };
}

export type StoreRow = {
  id: string; name: string; nameAr: string | null; slug: string; status: Tenant['status'];
  plan: PlanCode; subscription: string | null; readOnly: ReadOnlyReason | null; trialEndsAt: string | null; createdAt: string;
};

/** ADM-03 — stores, newest first, filtered; search matches name, Arabic name, address or id. */
export async function listStores(input: { q?: string; status?: Tenant['status']; plan?: PlanCode; before?: string; limit?: number } = {}): Promise<{ stores: StoreRow[]; next: string | null }> {
  const db = unsafeAdminDb(); // staff read across every store (A1)
  const limit = Math.min(input.limit ?? 50, 100);
  const q = input.q?.trim();
  const escaped = q?.replace(/[\\%_]/g, (c) => `\\${c}`);
  const where = and(
    isNull(tenants.deletedAt),
    input.status ? eq(tenants.status, input.status) : undefined,
    input.before ? lt(tenants.id, input.before) : undefined,
    q ? or(ilike(tenants.name, `%${escaped}%`), ilike(tenants.nameAr, `%${escaped}%`), ilike(tenants.slug, `%${escaped}%`), sql`${tenants.id}::text = ${q}`) : undefined,
  );
  const rows = await db.select({ tenant: tenants, status: subscriptions.status, code: plans.code })
    .from(tenants)
    .leftJoin(subscriptions, eq(subscriptions.tenantId, tenants.id))
    .leftJoin(plans, eq(plans.id, subscriptions.planId))
    .where(input.plan ? and(where, input.plan === 'starter' ? or(eq(plans.code, 'starter'), isNull(plans.code)) : eq(plans.code, input.plan)) : where)
    .orderBy(desc(tenants.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  return {
    stores: page.map(({ tenant, status, code }) => ({
      id: tenant.id, name: tenant.name, nameAr: tenant.nameAr, slug: tenant.slug, status: tenant.status,
      plan: code ?? 'starter', subscription: status ?? null,
      readOnly: writeStateOf({ subscriptionStatus: status ?? null, trialEndsAt: tenant.trialEndsAt }).readOnly,
      trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null, createdAt: tenant.createdAt.toISOString(),
    })),
    next: rows.length > limit ? page.at(-1)!.tenant.id : null,
  };
}

type Meter = { used: number; limit: number };

export type StoreDetail = {
  store: StoreRow & { crNumber: string | null; vatNumber: string | null; city: string | null; locale: string };
  usage: { products: Meter; team_members: Meter; storage_gb: Meter; ar_sessions: Meter; ai_credits: Meter };
  credits: { balance: number; usedThisMonth: number };
  invoices: Awaited<ReturnType<typeof invoicesOf>>;
  connections: Awaited<ReturnType<typeof listConnections>>;
  members: Awaited<ReturnType<typeof listTeam>>;
  staffTrail: Awaited<ReturnType<typeof staffTrail>>;
};

/** ADM-04…07 — one store: profile, usage against its plan, billing, connections, members, staff actions. */
export async function storeDetail(staff: StaffContext, storeId: string, now = new Date()): Promise<StoreDetail> {
  const db = unsafeAdminDb();
  const [tenant] = await db.select().from(tenants).where(and(eq(tenants.id, storeId), isNull(tenants.deletedAt))).limit(1);
  if (!tenant) throw errors.notFound('store');
  const ctx = inspectionContext(tenant, staff);
  const entitlements = await entitlementsOf(ctx);
  const [sub] = await db.select({ status: subscriptions.status }).from(subscriptions).where(eq(subscriptions.tenantId, storeId)).limit(1);
  const meter = async (key: 'products' | 'team_members' | 'storage_gb' | 'ar_sessions'): Promise<Meter> =>
    ({ used: await currentUsage(ctx, key, now), limit: entitlements.limit(key) });
  const usedThisMonth = await creditsUsedIn(ctx.db, currentPeriodStart(now), nextPeriodStart(now));

  return {
    store: {
      id: tenant.id, name: tenant.name, nameAr: tenant.nameAr, slug: tenant.slug, status: tenant.status,
      plan: entitlements.plan.code, subscription: sub?.status ?? null,
      readOnly: writeStateOf({ subscriptionStatus: sub?.status ?? null, trialEndsAt: tenant.trialEndsAt, now }).readOnly,
      trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null, createdAt: tenant.createdAt.toISOString(),
      crNumber: tenant.crNumber, vatNumber: tenant.vatNumber, city: tenant.city, locale: tenant.locale,
    },
    usage: {
      products: await meter('products'), team_members: await meter('team_members'), storage_gb: await meter('storage_gb'),
      ar_sessions: await meter('ar_sessions'),
      ai_credits: { used: usedThisMonth, limit: entitlements.limit('ai_credits') },
    },
    credits: { balance: await ctx.db.sum(creditLedger, creditLedger.delta), usedThisMonth },
    invoices: await invoicesOf(ctx),
    connections: await listConnections(ctx),
    members: await listTeam(ctx),
    staffTrail: await staffTrail({ storeId }),
  };
}

