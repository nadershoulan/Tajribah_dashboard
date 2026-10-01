/**
 * T62 — switching a store's own address on. A sweep (every scheduled pass): each address whose two DNS
 * records are in place (`ready`) is handed to the edge (`core/edge/custom-hostnames.ts`); once the edge
 * serves it with a certificate, it becomes `active` and the store's published configs are refreshed, so
 * its shoppers' try-on opens on the store's address from then on.
 *
 * Nothing here runs until Tajribah's Cloudflare zone is set (`customHostnames()` is null): a ready
 * address then simply stays ready. A store that left Enterprise is not switched on. One address that
 * fails (the edge refusing it, down, or our token wrong) is logged and the rest go on.
 */
import { and, eq } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { customDomains } from '@/db/schema';
import { auditedUpdate } from '@/server/core/audit/audit';
import { entitlementsOf } from '@/server/core/billing/entitlements';
import { customHostnames, type CustomHostnames } from '@/server/core/edge/custom-hostnames';
import { log } from '@/server/core/observability/log';
import { systemContext } from '@/server/core/tenancy/context';
import { enqueueEdgeRefresh } from '@/server/modules/edge/publish';

export const ACTIVATION_BATCH = 50;

export async function activateCustomDomains(edge: CustomHostnames | null = customHostnames()): Promise<{ asked: number; active: number; failed: number }> {
  const result = { asked: 0, active: 0, failed: 0 };
  if (!edge) return result;
  // A platform sweep across stores: ids and tenants only; each address is then handled inside its store.
  const due = await unsafeAdminDb().select({ id: customDomains.id, tenantId: customDomains.tenantId }).from(customDomains)
    .where(eq(customDomains.status, 'ready')).limit(ACTIVATION_BATCH);
  for (const { id, tenantId } of due) {
    try {
      const ctx = await systemContext({ tenantId, requestId: `domain-${id}`, permissions: ['settings:write'] });
      if (!(await entitlementsOf(ctx)).has('custom_domain')) continue;
      const row = await ctx.db.findOne(customDomains, and(eq(customDomains.id, id), eq(customDomains.status, 'ready')));
      if (!row) continue;
      let state = row.providerId ? await edge.get(row.providerId) : null;
      if (!state) { state = await edge.ensure(row.hostname); result.asked += 1; }
      if (state.id !== row.providerId || state.active) {
        await auditedUpdate(ctx, customDomains, id, { providerId: state.id, ...(state.active ? { status: 'active' as const } : {}) }, { resourceType: 'custom_domain' });
      }
      if (state.active) {
        result.active += 1;
        await enqueueEdgeRefresh(tenantId);
        log.info('custom domain switched on', { tenantId, hostname: row.hostname });
      }
    } catch (error) {
      result.failed += 1;
      log.warn('custom domain not switched on yet', { id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
