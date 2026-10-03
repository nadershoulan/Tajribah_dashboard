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
  /**
   * T68 — what is tried on. Left out: a watch, exactly as before. `eyewear`: the frame on a face photo,
   * `caseMm` then being the frame's front width. The studio's modes and controls are the same.
   */
  category?: 'watch' | 'eyewear';
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

export type ModelId = 'wrist' | 'lifestyle' | 'face';

export type ModelPhoto = { id: ModelId; label: Bi; stageLabel: Bi; src: string; thumb: string; pose: Pose };

export const MODELS: ModelPhoto[] = [
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

/**
 * T68 — glasses: a real front-facing portrait (Unsplash, Meital Anlen) and a real round metal frame
 * (Unsplash, Konsepta Studio), provenance in ASSETS.md. The pose is measured, not tuned by eye: the
 * pupils are 324 px apart on the 1200 × 1050 photo, taken as 62 mm (an adult's average), so 5.23 px a
 * millimetre; the demo frame, 132 mm across, is 690 px wide, centred between the pupils, tilted as
 * the eyes are (−2.3°). Another frame is drawn in proportion to its width, as watches are.
 */
export const DEMO_GLASSES: TryOnProduct = {
  sku: 'EX-ROUND-01',
  collection: { ar: 'نظارات طبية', en: 'Optical frames' },
  headLead: { ar: 'إطار', en: 'A frame' },
  headEm: { ar: 'يناسب وجهك.', en: 'that fits your face.' },
  name: { ar: 'نظارة بإطار معدني دائري', en: 'Round metal frame glasses' },
  finish: { ar: 'معدن أسود · عدسات شفافة', en: 'Black metal · clear lenses' },
  caseMm: 132,
  worn: '/assets/glasses-front.png',
  flat: '/assets/glasses-front.png',
  storeUrl: '',
  alt: { ar: 'نظارة بإطار معدني أسود دائري', en: 'Glasses with a round black metal frame' },
  storeLink: null,
  demo: false,
  onMe: false, // finding a face in the shopper's photo is not built yet
  category: 'eyewear',
};

export const FACE_MODELS: ModelPhoto[] = [
  {
    id: 'face',
    label: { ar: 'الوجه من الأمام', en: 'Face, front' },
    stageLabel: { ar: 'على الوجه', en: 'On a face' },
    src: '/assets/model-face.webp',
    thumb: '/assets/model-face-thumb.webp',
    pose: { x: 595, y: 528, width: 690, angle: -2.3 },
  },
];

/** The model photos for this product, and the width their poses were set for. */
export function modelsFor(product: TryOnProduct): { models: ModelPhoto[]; baseMm: number } {
  return product.category === 'eyewear'
    ? { models: FACE_MODELS, baseMm: DEMO_GLASSES.caseMm }
    : { models: MODELS, baseMm: DEMO_WATCH.caseMm };
}

export type ReferenceId = 'iphone' | 'airpods' | 'riyal';

export const REFERENCES: Record<ReferenceId, { name: Bi; src: string; w: number; h: number }> = {
  iphone: { name: { ar: 'آيفون 15', en: 'iPhone 15' }, src: '/assets/iphone.png', w: 71.6, h: 147.6 },
  airpods: { name: { ar: 'إيربودز', en: 'AirPods' }, src: '/assets/airpods.webp', w: 44.3, h: 53.5 },
  riyal: { name: { ar: 'ريال سعودي', en: '1 Saudi riyal' }, src: '/assets/riyal.webp', w: 23, h: 23 },
};

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

/** Keep the watch on the wrist in each photo — tuned to the two model shots. */
export function constrainToModel(model: ModelId, p: Pose): Pose {
  if (model === 'face') return { ...p, x: clamp(p.x, 555, 635), y: clamp(p.y, 495, 565) }; // across the eyes
  if (model === 'wrist') {
    const x = clamp(p.x, 240, 440);
    return { ...p, x, y: clamp(p.y, 540 + (x - 350) * 0.025, 565 + (x - 350) * 0.025) };
  }
  const x = clamp(p.x, 550, 655);
  const y = 492 - (x - 607) * 0.61;
  return { ...p, x, y: clamp(p.y, y - 15, y + 15) };
}
