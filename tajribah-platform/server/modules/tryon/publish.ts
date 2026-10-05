/**
 * T90 — publish a product's try-on in one step, from its try-on settings: the way a new merchant gets a
 * product into the shop now that 3D models are version 2. When the try-on is complete (its picture(s)
 * and its width), this switches it on, puts the button where that kind goes if a saved placement says
 * otherwise (a product whose type changed: glasses on the face, a bag not on the wrist), and publishes
 * through the same path as AR settings' "Publish to the store" — the same checks, the same version.
 * Incomplete: refused with what is missing, and nothing changes.
 */
import { eq } from 'drizzle-orm';
import { arConfigs } from '@/db/schema';
import { placementsFor } from '@/lib/contracts/ar-config';
import { placementFitsKind } from '@/lib/tryon';
import type { PublishResult } from '@/lib/contracts/ar-config';
import { auditedUpdate } from '@/server/core/audit/audit';
import { errors } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import { publishProduct } from '@/server/modules/edge/publish';
import { tryOnOne, updateTryOn } from './service';

const MISSING: Record<'worn' | 'flat' | 'case', string> = {
  worn: 'its try-on picture',
  flat: 'the product shot',
  case: 'its width',
};

/** API-192 — POST /api/tryon/[productId]/publish. */
export async function publishTryOn(ctx: TenantContext, productId: string): Promise<PublishResult> {
  ctx.require('tryon:write');
  ctx.require('ar:publish');
  const one = await tryOnOne(ctx, productId);
  const card = one.watches[0];
  if (!card) throw errors.conflict(one.jewelry.length ? 'mark this jewelry as a ring, a necklace or an earring first' : 'this product’s type is not tried on — set it to Watch, Eyewear, Jewelry or Bag first');
  if (card.missing.length) throw errors.conflict(`finish the try-on first: add ${card.missing.map((m) => MISSING[m]).join(' and ')}`);
  if (!card.enabled) await updateTryOn(ctx, productId, { enabled: true });
  const saved = await ctx.db.findOne(arConfigs, eq(arConfigs.productId, productId));
  if (saved && !placementFitsKind(card.kind, saved.placement)) {
    const placement = placementsFor(one.product.productType).find((p) => placementFitsKind(card.kind, p));
    if (placement) await auditedUpdate(ctx, arConfigs, saved.id, { placement }, { resourceType: 'ar_config' });
  }
  return publishProduct(ctx, productId);
}
