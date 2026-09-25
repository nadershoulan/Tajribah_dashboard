/**
 * P1.21 — how the AR button and viewer behave for one product: the contract shared by the
 * API (validation) and the screen (types, instant feedback).
 *
 *  - Labels in both languages, short enough for a button on a phone (40 characters).
 *  - Placement: floor / wall / table for anything; `face` only for eyewear and `wrist` only for
 *    watches and jewellery — those are try-on anchors, and a sofa on a wrist is a bug report.
 *  - Scale is a correction factor (0.5–2×) on the true size from the millimetres, stored in
 *    basis points; shadow strength 0–2×, same. Neither replaces measuring the product.
 */
import { z } from 'zod';
import type { ProductRow } from '../view-models';

export const PLACEMENTS = ['floor', 'wall', 'table', 'face', 'wrist'] as const;
export type Placement = (typeof PLACEMENTS)[number];

/** Which placements a product type may use. */
export function placementsFor(type: ProductRow['productType']): Placement[] {
  if (type === 'eyewear') return ['face', 'table'];
  if (type === 'watch' || type === 'jewelry') return ['wrist', 'table'];
  return ['floor', 'wall', 'table'];
}

export const DEFAULT_AR_CONFIG = {
  buttonLabelAr: 'شاهدها في مكانك',
  buttonLabelEn: 'View in your space',
  variant: 'solid' as 'solid' | 'outline',
  showIcon: true,
  scale: 1,
  autoRotate: true,
  shadow: 1,
};

export const ArConfigInput = z.object({
  buttonLabelAr: z.string().trim().min(1, 'the button needs a label').max(40, 'at most 40 characters'),
  buttonLabelEn: z.string().trim().min(1, 'the button needs a label').max(40, 'at most 40 characters'),
  variant: z.enum(['solid', 'outline']),
  showIcon: z.boolean(),
  placement: z.enum(PLACEMENTS),
  scale: z.number().min(0.5, 'between 0.5× and 2×').max(2, 'between 0.5× and 2×'),
  autoRotate: z.boolean(),
  shadow: z.number().min(0, 'between 0 and 2').max(2, 'between 0 and 2'),
}).strict();
export type ArConfigInput = z.infer<typeof ArConfigInput>;

export type ArConfigView = ArConfigInput & {
  productId: string;
  productName: string;
  productNameAr: string | null;
  productType: ProductRow['productType'];
  arEnabled: boolean;
  /** False until the merchant saves anything: the defaults are shown, not stored. */
  saved: boolean;
  /** 0 until the edge config is published (P1.15). */
  publishedVersion: number;
  /** Saved after the last publish — what shoppers see is older than this. */
  unpublishedChanges: boolean;
};

/** The placement-for-type rule, as field errors (empty when allowed). */
export function placementErrors(type: ProductRow['productType'], placement: Placement): Record<string, string[]> {
  return placementsFor(type).includes(placement) ? {} : { placement: [`not for this kind of product — use ${placementsFor(type).join(' or ')}`] };
}
