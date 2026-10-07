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
import type { HostedPageView } from './hosted-page';

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
  // T104: minimal by default — no colour of its own; filled and outline wear the store's colour
  variant: 'minimal' as 'minimal' | 'solid' | 'outline',
  showIcon: true,
  scale: 1,
  autoRotate: true,
  shadow: 1,
};

/**
 * The button's words until the merchant writes their own (P1.15): a watch's button opens the try-on
 * on the wrist, so "view in your space" would promise the wrong thing.
 */
export function defaultLabelsFor(type: ProductRow['productType']): { buttonLabelAr: string; buttonLabelEn: string } {
  return type === 'watch'
    ? { buttonLabelAr: 'جرّبها على معصمك', buttonLabelEn: 'Try it on your wrist' }
    : { buttonLabelAr: DEFAULT_AR_CONFIG.buttonLabelAr, buttonLabelEn: DEFAULT_AR_CONFIG.buttonLabelEn };
}

export const ArConfigInput = z.object({
  buttonLabelAr: z.string().trim().min(1, 'the button needs a label').max(40, 'at most 40 characters'),
  buttonLabelEn: z.string().trim().min(1, 'the button needs a label').max(40, 'at most 40 characters'),
  variant: z.enum(['minimal', 'solid', 'outline']),
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
  /** 0 until the product's config is published (P1.15); the version shoppers see. */
  publishedVersion: number;
  publishedAt: string | null;
  /**
   * Published: what would be published now differs from what shoppers see (any source — these
   * settings, the model, the try-on, the store's colours, the plan). Not published: saved settings.
   */
  unpublishedChanges: boolean;
  /** P1.19: the product's own page — its address while published, on or off, the buy link. */
  page: HostedPageView | null;
  /** T90: its try-on — null when its type is not tried on (or jewelry not marked); else whether it is complete. */
  tryon?: { ready: boolean } | null;
};

/** API-102's answer (P1.15): the version shoppers now see. */
export type PublishResult = { version: number; publishedAt: string | null; outdated: boolean };

/** The placement-for-type rule, as field errors (empty when allowed). */
export function placementErrors(type: ProductRow['productType'], placement: Placement): Record<string, string[]> {
  return placementsFor(type).includes(placement) ? {} : { placement: [`not for this kind of product — use ${placementsFor(type).join(' or ')}`] };
}

/** T73 — one numbered page of `GET /api/ar-configs?page=&q=`: products already set up first. */
export type ArConfigPage = { configs: ArConfigView[]; total: number; page: number; pageSize: number };
