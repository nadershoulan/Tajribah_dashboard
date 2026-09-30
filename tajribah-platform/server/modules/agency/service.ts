/**
 * T62 — agency accounts: one login that manages its clients' stores sees all of them at once.
 *
 * Nothing new is granted: the overview lists exactly the stores the person could switch to (their
 * active memberships — a single sign-on session only its own store), and each store's summary is
 * read **inside that store's own context** — its membership checked, its role's permissions applied,
 * row-level security on — the way that store's own screens read it. A store whose role cannot read
 * products shows no figures rather than failing the whole list. No commissions or reseller terms:
 * those are Nader's to set (T62).
 */
import { and, gte, isNull, ne } from 'drizzle-orm';
import { dailyTenantStats, edgeConfigs, products, storeConnections } from '@/db/schema';
import { riyadhDay } from '@/lib/format';
import type { StoreOverview } from '@/lib/view-models';
import { entitlementsOf } from '@/server/core/billing/entitlements';
import { buildTenantContext, membershipsOf } from '@/server/core/tenancy/context';
import { connectionHealth } from '@/server/modules/connections/health';
import { onboardingOf } from '@/server/modules/onboarding/service';

const DAY = 86_400_000;
/** More stores than an agency screen can usefully show at once; the rest are one switch away. */
export const OVERVIEW_LIMIT = 100;
const TRIAL_WARNING_DAYS = 3;
/** Most urgent first: the store cannot work, then it will soon stop, then it works badly, then it is unfinished. */
export const ATTENTION_ORDER: StoreOverview['attention'] = ['suspended', 'read_only', 'past_due', 'trial_ending', 'connection', 'setup'];

type Actor = { userId: string; email: string; isStaff: boolean };

export async function storesOverview(actor: Actor, options: { requestId: string; onlyTenantId?: string | null; now?: Date }): Promise<StoreOverview[]> {
  const now = options.now ?? new Date();
  const memberships = (await membershipsOf(actor.userId))
    .filter(({ tenant }) => !options.onlyTenantId || tenant.id === options.onlyTenantId)
    .sort((a, b) => a.tenant.name.localeCompare(b.tenant.name, 'ar'))
    .slice(0, OVERVIEW_LIMIT);
  const days = Array.from({ length: 30 }, (_, i) => riyadhDay(now.getTime() - (29 - i) * DAY));

  const out: StoreOverview[] = [];
  for (const { tenant, role } of memberships) {
    // A suspended store cannot be opened (a billing or compliance hold): listed, with nothing read from it.
    if (tenant.status === 'suspended') {
      out.push({
        id: tenant.id, name: tenant.name, slug: tenant.slug, role, plan: '', status: 'suspended', trialEndsAt: null, readOnly: null,
        products: 0, liveButtons: 0, setupComplete: false, connection: null, last30: { views: 0, arSessions: 0, tryonSessions: 0 }, attention: ['suspended'],
      });
      continue;
    }
    const ctx = await buildTenantContext({ actor, tenantId: tenant.id, requestId: options.requestId });
    const plan = (await entitlementsOf(ctx)).plan.code;
    const reads = ctx.can('products:read');
    const live = and(isNull(products.deletedAt), ne(products.status, 'archived'));
    const [productCount, liveButtons, onboarding, stats, connectionRow] = await Promise.all([
      reads ? ctx.db.count(products, live) : 0,
      reads ? ctx.db.count(edgeConfigs, isNull(edgeConfigs.withdrawnAt)) : 0,
      reads ? onboardingOf(ctx) : null,
      reads ? ctx.db.find(dailyTenantStats, gte(dailyTenantStats.day, days[0]!), { limit: 40 }) : [],
      ctx.can('connections:read') ? ctx.db.findOne(storeConnections, ne(storeConnections.status, 'revoked')).then((r) => r ?? ctx.db.findOne(storeConnections)) : null,
    ]);
    const health = connectionRow ? await connectionHealth(ctx.db, connectionRow, now) : null;
    const sum = (key: 'views' | 'arSessions' | 'tryonSessions') => stats.reduce((total, r) => total + Number(r[key] ?? 0), 0);

    const attention: StoreOverview['attention'] = [];
    if (ctx.readOnly) attention.push('read_only');
    if (tenant.status === 'past_due') attention.push('past_due');
    if (tenant.status === 'trial' && tenant.trialEndsAt && tenant.trialEndsAt.getTime() - now.getTime() < TRIAL_WARNING_DAYS * DAY) attention.push('trial_ending');
    if (health && health.level !== 'healthy') attention.push('connection');
    if (onboarding && !onboarding.complete) attention.push('setup');

    out.push({
      id: tenant.id, name: tenant.name, slug: tenant.slug, role, plan,
      status: tenant.status as StoreOverview['status'],
      trialEndsAt: tenant.trialEndsAt?.toISOString() ?? null, readOnly: ctx.readOnly,
      products: productCount, liveButtons, setupComplete: onboarding?.complete ?? false,
      connection: connectionRow && health ? {
        provider: connectionRow.provider, status: connectionRow.status as NonNullable<StoreOverview['connection']>['status'],
        health: health.level, lastSyncAt: connectionRow.lastSyncAt?.toISOString() ?? null,
      } : null,
      last30: { views: sum('views'), arSessions: sum('arSessions'), tryonSessions: sum('tryonSessions') },
      attention,
    });
  }
  // The most urgent first (the order of ATTENTION_ORDER), then by name.
  const rank = (s: StoreOverview) => Math.min(...s.attention.map((a) => ATTENTION_ORDER.indexOf(a)), ATTENTION_ORDER.length);
  return out.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name, 'ar'));
}
