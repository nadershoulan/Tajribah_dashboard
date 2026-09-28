import type { Bi } from './lang';

/** Stage size and scale the studio works in (unchanged from the original build). */
export const STAGE = { W: 1200, H: 1050 };
export const PX_PER_MM = 4.3;

export type Pose = { x: number; y: number; width: number; angle: number };

/**
 * What the studio shows for one watch. The studio defaults to `DEMO_WATCH`; a merchant's own
 * watch comes in through `<Studio product={…} />` (P5, T26 — added, nothing in the studio moved).
 * `demo` switches on the demo-store badge and the no-partnership note; `storeLink` is the
 * "explore the store" link, or null for none (on the merchant's own page it would lead nowhere new).
 */
export type TryOnProduct = {
  sku: string;
  collection: Bi;
  headLead: Bi;
  headEm: Bi;
  name: Bi;
  finish: Bi;
  caseMm: number;
  worn: string;
  flat: string;
  storeUrl: string;
  alt: Bi;
  storeLink: { label: Bi; href: string } | null;
  demo: boolean;
  /**
   * T33: `false` hides "On me" (the shopper's own photo — Pro and up); the studio then offers the
   * model and the size comparison, which every plan has. Left out (the demo), all three modes.
   */
  onMe?: boolean;
};

/**
 * The demo product. Case width is approximate, inferred from the reference
 * widget's watch/iPhone relative sizes — see ASSETS.md.
 */
export const DEMO_WATCH: TryOnProduct = {
  sku: 'P820241410',
  collection: { ar: 'تشكيلة الألماس', en: 'The diamond collection' } as Bi,
  headLead: { ar: 'لمسة من', en: 'A touch of' } as Bi,
  headEm: { ar: 'الأخضر.', en: 'emerald.' } as Bi,
  name: { ar: 'ساعة فايلت النسائية الألماس', en: 'Failet women’s diamond watch' } as Bi,
  finish: { ar: 'ذهبي · مينا أخضر', en: 'Gold · green dial' } as Bi,
  caseMm: 29.3,
  worn: '/assets/watch-layer-0.png',
  flat: '/assets/watch-flat.png',
  storeUrl: 'https://failet.sa',
  alt: { ar: 'ساعة فايلت ذهبية بمينا أخضر وسوار متعدد الألوان', en: 'Failet gold watch with a green dial and multicolour bracelet' },
  storeLink: { label: { ar: 'تسوّق فايلت', en: 'Explore Failet' }, href: 'https://failet.sa' },
  demo: true,
};

export type ModelId = 'wrist' | 'lifestyle';

export const MODELS: {
  id: ModelId; label: Bi; stageLabel: Bi; src: string; thumb: string; pose: Pose;
}[] = [
  {
    id: 'wrist',
    label: { ar: 'المعصم عن قرب', en: 'Wrist close-up' },
    stageLabel: { ar: 'على المعصم', en: 'On your wrist' },
    src: '/assets/model-wrist.webp',
    thumb: '/assets/model-wrist-thumb.webp',
    pose: { x: 350, y: 553, width: 139, angle: 0 },
  },
  {
    id: 'lifestyle',
    label: { ar: 'إطلالة يومية', en: 'Lifestyle' },
    stageLabel: { ar: 'إطلالة يومية', en: 'Everyday perspective' },
    src: '/assets/model-lifestyle.webp',
    thumb: '/assets/model-lifestyle-thumb.webp',
    pose: { x: 607, y: 492, width: 112, angle: -34 },
  },
];

export type ReferenceId = 'iphone' | 'airpods' | 'riyal';

export const REFERENCES: Record<ReferenceId, { name: Bi; src: string; w: number; h: number }> = {
  iphone: { name: { ar: 'آيفون 15', en: 'iPhone 15' }, src: '/assets/iphone.png', w: 71.6, h: 147.6 },
  airpods: { name: { ar: 'إيربودز', en: 'AirPods' }, src: '/assets/airpods.webp', w: 44.3, h: 53.5 },
  riyal: { name: { ar: 'ريال سعودي', en: '1 Saudi riyal' }, src: '/assets/riyal.webp', w: 23, h: 23 },
};

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

/** Keep the watch on the wrist in each photo — tuned to the two model shots. */
export function constrainToModel(model: ModelId, p: Pose): Pose {
  if (model === 'wrist') {
    const x = clamp(p.x, 240, 440);
    return { ...p, x, y: clamp(p.y, 540 + (x - 350) * 0.025, 565 + (x - 350) * 0.025) };
  }
  const x = clamp(p.x, 550, 655);
  const y = 492 - (x - 607) * 0.61;
  return { ...p, x, y: clamp(p.y, y - 15, y + 15) };
}
