/**
 * T62 — switching a store's own address on. A sweep (every scheduled pass): each address whose two DNS
 * records are in place (`ready`) is handed to the edge (`core/edge/custom-hostnames.ts`); once the edge
 * serves it with a certificate, it becomes `active` and the store's published configs are refreshed, so
 * its shoppers' try-on opens on the store's address from then on.
 *
 * Nothing here runs until Tajribah's Cloudflare zone is set (`customHostnames()` is null): a ready
 * address then simply stays ready. A store that left Enterprise is not switched on. One address that
 * fails (the edge refusing it, down, or our token wrong) is logged and the rest go on.
 *
 * And a **watch** (`watchCustomDomains`): every address is looked at again about every fifteen minutes
 * — its DNS records, and for a live one whether the edge still serves it — so a merchant need not
 * press "Check now" after adding the records, and a live address whose records are taken away stops
 * being used by shoppers within minutes, not when someone next looks. Nothing is stored to pace it
 * (each address has its own minute of the quarter-hour, from its id), and only a change of standing is
 * written.
 */
import { and, eq } from 'drizzle-orm';
import { standingOf } from './service';
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

export const WATCH_EVERY_MINUTES = 15;
/** The minute of each quarter-hour in which an address is looked at — from its id, so nothing is stored. */
export function watchSlot(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return h % WATCH_EVERY_MINUTES;
}

export async function watchCustomDomains(deps: { edge?: CustomHostnames | null; fetch?: typeof fetch; now?: Date } = {}): Promise<{ looked: number; changed: number; failed: number }> {
  const now = deps.now ?? new Date();
  const edge = deps.edge === undefined ? customHostnames() : deps.edge;
  const slot = Math.floor(now.getTime() / 60_000) % WATCH_EVERY_MINUTES;
  const result = { looked: 0, changed: 0, failed: 0 };
  // A platform sweep across stores: ids and tenants only; each address is then handled inside its store.
  const all = await unsafeAdminDb().select({ id: customDomains.id, tenantId: customDomains.tenantId }).from(customDomains);
  for (const { id, tenantId } of all.filter((d) => watchSlot(d.id) === slot)) {
    try {
      const ctx = await systemContext({ tenantId, requestId: `domain-watch-${id}`, permissions: ['settings:write'] });
      const row = await ctx.db.findOne(customDomains, eq(customDomains.id, id));
      if (!row) continue;
      result.looked += 1;
      const found = await standingOf(row, { fetch: deps.fetch, now });
      let status = found.status;
      // Live by its records — but does the edge still serve it? If not, it is asked for again (`ready`).
      if (status === 'active' && edge && row.providerId) {
        const state = await edge.get(row.providerId);
        if (!state?.active) status = 'ready';
      }
      if (status === row.status) continue; // the same standing: nothing to write
      await auditedUpdate(ctx, customDomains, id, { ...found.patch, status, ...(status === 'ready' && row.status === 'active' ? { providerId: null } : {}) }, { resourceType: 'custom_domain' });
      result.changed += 1;
      if (row.status === 'active') await enqueueEdgeRefresh(tenantId);
      log.info('custom domain standing changed', { tenantId, hostname: row.hostname, from: row.status, to: status });
    } catch (error) {
      result.failed += 1;
      log.warn('custom domain not looked at', { id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return result;
}
