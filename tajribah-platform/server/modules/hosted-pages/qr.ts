/**
 * P1.20 — QR codes: one per product with a live page of its own, carrying that page's address tagged
 * `?s=qr` (the website counts the visit as "from a QR code", `tajribah-try-on/lib/page-events.ts`).
 *
 * A printed code cannot be changed, so it is offered for printing only when the address is final —
 * the store's own address (Enterprise, T62), or the address production sets in `HOSTED_PAGE_BASE` (T106:
 * `https://tajribah.org/p`, in `deploy/production.jsonc`). Unset — a local run — is never final.
 * Before that the screen shows each code as a preview, marked, with no download (DECISIONS P1.20).
 * The codes are drawn in the browser from these addresses; nothing is stored.
 */
import { and, inArray, isNotNull, isNull } from 'drizzle-orm';
import { edgeConfigs, hostedPages, products } from '@/db/schema';
import { DEFAULT_HOSTED_PAGE_BASE, qrUrl, type QrScreen } from '@/lib/contracts/hosted-page';
import { entitlementsOf } from '@/server/core/billing/entitlements';
import { loadEnv } from '@/server/core/config/env';
import type { TenantContext } from '@/server/core/tenancy/context';
import { customHostOf, hostedPageViewOf } from './view';
import { isLocalHost } from '@site/lib/tryon-config';

/** The page address once it is set for real: an https base set explicitly (T106: tajribah.org/p itself), never unset or local. */
function finalBase(): string | null {
  let base: string | undefined;
  try { base = loadEnv().HOSTED_PAGE_BASE; } catch { base = undefined; }
  return base && base.startsWith('https://') ? base : null;
}

/** T82: the page base is this computer (http on localhost or its Wi-Fi address): codes to test with, not to print. */
function onThisComputer(): boolean {
  let base: string | undefined;
  try { base = loadEnv().HOSTED_PAGE_BASE; } catch { base = undefined; }
  try { return !!base && base.startsWith('http://') && isLocalHost(new URL(base).hostname); } catch { return false; }
}

export async function qrCodesFor(ctx: TenantContext): Promise<QrScreen> {
  ctx.require('ar:read');
  const customHost = await customHostOf(ctx);
  const base = customHost ? `https://${customHost}/p` : finalBase() ?? DEFAULT_HOSTED_PAGE_BASE;
  const printable = !!customHost || finalBase() !== null;
  if (!(await entitlementsOf(ctx)).has('qr_codes')) return { included: false, printable, testOnly: !printable && onThisComputer(), base, products: [] };

  const live = await ctx.db.find(edgeConfigs, and(isNotNull(edgeConfigs.key), isNull(edgeConfigs.withdrawnAt)));
  if (!live.length) return { included: true, printable, testOnly: !printable && onThisComputer(), base, products: [] };
  const ids = live.map((e) => e.productId);
  const [rows, pages] = await Promise.all([
    ctx.db.find(products, and(inArray(products.id, ids), isNull(products.deletedAt))),
    ctx.db.find(hostedPages, inArray(hostedPages.productId, ids)),
  ]);
  const edgeOf = new Map(live.map((e) => [e.productId, e]));
  const pageOf = new Map(pages.map((p) => [p.productId, p]));
  const out: QrScreen['products'] = [];
  let withoutBuyLink = 0;
  for (const product of rows) {
    const view = hostedPageViewOf(ctx.tenant.slug, product, pageOf.get(product.id) ?? null, edgeOf.get(product.id), customHost);
    // A page switched off has no code: the code would open "not available".
    if (!view.url || !view.active) continue;
    out.push({ id: product.id, name: product.name, nameAr: product.nameAr ?? null, url: qrUrl(view.url) });
    if (!view.shopUrl && view.storePage) withoutBuyLink += 1;
  }
  out.sort((a, b) => a.name.localeCompare(b.name));
  return { included: true, printable, testOnly: !printable && onThisComputer(), base, products: out, withoutBuyLink };
}
