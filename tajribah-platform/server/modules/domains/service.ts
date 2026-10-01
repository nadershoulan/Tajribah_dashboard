/**
 * T62 — an Enterprise store's own address for its AR and try-on pages (like `ar.theirstore.com`).
 *
 *  - **Which names**: a subdomain the store controls — three labels at least (a CNAME cannot sit on a
 *    bare domain), letters, digits and hyphens (an Arabic name is taken in its `xn--` form), never one
 *    of Tajribah's own, an address on this machine or an IP address.
 *  - **Two records**, both checked over DNS (`core/dns/doh.ts`): a TXT record at
 *    `_tajribah-verify.<name>` carrying this store's token — proof the name is the store's; and a CNAME
 *    from the name to Tajribah's address for custom domains — where shoppers will be sent.
 *  - **One name per store; one store per name**: a name another store has claimed is refused (the
 *    database's global unique index — the other store stays invisible). Changing the name starts over
 *    with a new token.
 *  - **Switching it on** is Cloudflare's (for SaaS custom hostnames, `activation.ts`): until
 *    Tajribah's zone serves the name, a store with both records in place is `ready`. Once `active`,
 *    the store's published configs name the address and its shoppers' try-on opens there; leaving
 *    `active` (the records gone, the name changed or removed) takes it out of the configs at once and
 *    asks Cloudflare to stop serving the old name.
 */
import { customDomains, type CUSTOM_DOMAIN_STATUS } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import type { CustomDomainView } from '@/lib/view-models';
import { auditedDelete, auditedInsert, auditedUpdate } from '@/server/core/audit/audit';
import { assertFeature, entitlementsOf } from '@/server/core/billing/entitlements';
import { loadEnv } from '@/server/core/config/env';
import { lookup } from '@/server/core/dns/doh';
import { customHostnames } from '@/server/core/edge/custom-hostnames';
import { log } from '@/server/core/observability/log';
import { enqueueEdgeRefresh } from '@/server/modules/edge/publish';
import { errors, isUniqueViolation } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';

export const VERIFY_LABEL = '_tajribah-verify';
export const DEFAULT_TARGET = 'domains.tajribah.sa';
const OURS = ['tajribah.sa', 'tajribah.com'];
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Where a store's CNAME must point: Tajribah's address for custom domains. */
export const domainTarget = () => (loadEnv().CUSTOM_DOMAIN_TARGET ?? DEFAULT_TARGET).toLowerCase();

/** `https://AR.TheirStore.com/x` or `ar.theirstore.com.` → `ar.theirstore.com`; refused when it cannot be one. */
export function hostnameOf(input: string): string {
  const refuse = (why: string) => errors.validation({ hostname: [why] });
  let text = input.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0]!.replace(/\.$/, '');
  if (text.includes('@') || text.includes(':')) throw refuse('an address like ar.yourstore.com — no port or login');
  try { text = new URL(`https://${text}`).hostname; } catch { throw refuse('not an address'); } // IDN → xn--
  const labels = text.split('.');
  if (text.length > 253 || labels.some((l) => !LABEL.test(l))) throw refuse('not an address');
  if (/^\d+$/.test(labels.at(-1)!)) throw refuse('an address, not an IP address');
  if (labels.length < 3) throw refuse('a subdomain, like ar.yourstore.com — a bare domain cannot point elsewhere');
  if (OURS.some((d) => text === d || text.endsWith(`.${d}`)) || text.endsWith('.localhost')) throw refuse('an address of your own store');
  return text;
}

type Row = typeof customDomains.$inferSelect;

/** The name is no longer this store's address: out of its configs, and no longer served. Best effort at the edge. */
async function retire(ctx: TenantContext, row: Row): Promise<void> {
  if (row.status === 'active') await enqueueEdgeRefresh(ctx.tenantId);
  const edge = customHostnames();
  if (row.providerId && edge) {
    try { await edge.remove(row.providerId); } catch (error) {
      log.warn('custom hostname not removed at the edge', { hostname: row.hostname, error: error instanceof Error ? error.message : String(error) });
    }
  }
}

function viewOf(row: Row, seen: { txt: boolean; cname: boolean; pointsTo: string | null } | null): CustomDomainView {
  const status = row.status;
  return {
    hostname: row.hostname, status,
    records: [
      { type: 'CNAME', name: row.hostname, value: domainTarget(), seen: seen?.cname ?? (status === 'ready' || status === 'active') },
      { type: 'TXT', name: `${VERIFY_LABEL}.${row.hostname}`, value: `tajribah-verification=${row.token}`, seen: seen?.txt ?? status !== 'pending' },
    ],
    verifiedAt: row.verifiedAt?.toISOString() ?? null,
    checkedAt: row.checkedAt?.toISOString() ?? null,
    pointsTo: seen?.pointsTo ?? (row.lastProblem?.startsWith('cname_elsewhere:') ? row.lastProblem.slice('cname_elsewhere:'.length) : null),
  };
}

/** API-089 (GET) — the store's address, or null. */
export async function customDomain(ctx: TenantContext): Promise<CustomDomainView | null> {
  ctx.require('settings:read');
  const row = await ctx.db.findOne(customDomains);
  return row ? viewOf(row, null) : null;
}

/** API-089 (PUT) — set (or change) the store's address; a change starts over with a new token. */
export async function setCustomDomain(ctx: TenantContext, input: string): Promise<CustomDomainView> {
  ctx.require('settings:write');
  assertFeature(await entitlementsOf(ctx), 'custom_domain');
  const hostname = hostnameOf(input);
  const token = [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');
  const current = await ctx.db.findOne(customDomains);
  if (current?.hostname === hostname) return viewOf(current, null);
  const fresh = { hostname, token, status: 'pending' as const, verifiedAt: null, checkedAt: null, lastProblem: null, providerId: null };
  try {
    const row = current
      ? await auditedUpdate(ctx, customDomains, current.id, fresh, { resourceType: 'custom_domain' })
      : await auditedInsert(ctx, customDomains, { id: uuidv7(), tenantId: ctx.tenantId, ...fresh }, { resourceType: 'custom_domain' });
    if (current) await retire(ctx, current);
    return viewOf(row as Row, null);
  } catch (error) {
    if (isUniqueViolation(error)) throw errors.conflict('this address is already used by another Tajribah store');
    throw error;
  }
}

/** API-089 (DELETE) — stop using an address. */
export async function removeCustomDomain(ctx: TenantContext): Promise<void> {
  ctx.require('settings:write');
  const current = await ctx.db.findOne(customDomains);
  if (!current) return;
  await auditedDelete(ctx, customDomains, current.id, { resourceType: 'custom_domain' });
  await retire(ctx, current);
}

/**
 * API-091 — look the two records up now. The TXT record proves the name (once proven, it stays
 * proven); the CNAME is where shoppers will be sent. An address already switched on stays on.
 */
export async function checkCustomDomain(ctx: TenantContext, deps: { fetch?: typeof fetch; now?: Date } = {}): Promise<CustomDomainView> {
  ctx.require('settings:write');
  assertFeature(await entitlementsOf(ctx), 'custom_domain');
  const row = await ctx.db.findOne(customDomains);
  if (!row) throw errors.notFound('custom domain');
  const found = await standingOf(row, deps);
  // Someone pressing "Check now": on the trail, with what it found.
  const updated = await auditedUpdate(ctx, customDomains, row.id, found.patch, { resourceType: 'custom_domain' });
  // No longer in place: shoppers go back to Tajribah's own address at once (the edge keeps the name
  // for when the records return).
  if (row.status === 'active' && found.status !== 'active') await enqueueEdgeRefresh(ctx.tenantId);
  return viewOf(updated as Row, found);
}

/** What the DNS says of `row` now, and the standing that follows — written by whoever asked (a check, or the watch). */
export async function standingOf(row: Row, deps: { fetch?: typeof fetch; now?: Date } = {}) {
  const [txts, cnames] = await Promise.all([
    lookup(`${VERIFY_LABEL}.${row.hostname}`, 'TXT', deps.fetch),
    lookup(row.hostname, 'CNAME', deps.fetch),
  ]);
  const txt = txts.includes(`tajribah-verification=${row.token}`);
  const cname = cnames.includes(domainTarget());
  const pointsTo = !cname && cnames.length ? cnames[0]! : null;
  const status: (typeof CUSTOM_DOMAIN_STATUS)[number] = row.status === 'active' && txt && cname ? 'active' : !txt ? 'pending' : cname ? 'ready' : 'verified';
  const now = deps.now ?? new Date();
  const patch = {
    status, checkedAt: now,
    verifiedAt: row.verifiedAt ?? (txt ? now : null),
    lastProblem: !txt ? 'txt' : !cname ? (pointsTo ? `cname_elsewhere:${pointsTo}` : 'cname') : null,
  };
  return { txt, cname, pointsTo, status, patch };
}
