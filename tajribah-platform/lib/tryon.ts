/**
 * P5.10 — what a merchant is told about a watch cut-out, in both languages. The server answers
 * with the English line; the screen shows the merchant's language (`sayCutout`).
 */
import type { Bi } from './lang';

export type CutoutIssueCode = 'not_png_or_webp' | 'unreadable' | 'no_transparency' | 'too_small' | 'too_large_file';

export const CUTOUT_ISSUES: Record<CutoutIssueCode, Bi> = {
  not_png_or_webp: { ar: 'يجب أن تكون PNG أو WebP بخلفية شفافة.', en: 'must be a PNG or WebP with a transparent background' },
  unreadable: { ar: 'تعذّرت قراءة الصورة.', en: 'the image could not be read' },
  no_transparency: { ar: 'بلا شفافية — احفظ الصورة المقصوصة PNG أو WebP بخلفية شفافة.', en: 'has no transparency — save the cut-out as a PNG or WebP with a transparent background' },
  too_small: { ar: 'صغيرة جدًا: 200 بكسل على الأقل للضلع الأطول.', en: 'is too small: at least 200 pixels on its long side' },
  too_large_file: { ar: 'أكبر من 10 ميجابايت.', en: 'is larger than 10 MB' },
};

/** A refusal line (the English line or its code) in the reader's language; unknown lines as written. */
export function sayCutout(line: string): Bi {
  const hit = (Object.entries(CUTOUT_ISSUES) as [CutoutIssueCode, Bi][]).find(([code, text]) => code === line || text.en === line);
  return hit ? hit[1] : { ar: line, en: line };
}

export const TRYON_SLOTS: Record<'worn' | 'flat', { label: Bi; hint: Bi }> = {
  worn: {
    label: { ar: 'الساعة كما تُلبس', en: 'The watch as worn' },
    hint: { ar: 'الساعة من الأمام بسوارها مفتوحًا كما على المعصم، مقصوصة بخلفية شفافة.', en: 'The watch from the front with its strap as on a wrist, cut out on a transparent background.' },
  },
  flat: {
    label: { ar: 'صورة المنتج', en: 'The product shot' },
    hint: { ar: 'الساعة وحدها من الأمام، مقصوصة بخلفية شفافة — تُستخدم في المقارنة بالحجم.', en: 'The watch alone from the front, cut out on a transparent background — used in the size comparison.' },
  },
};

/**
 * P5.2 (T68) — what can be tried on, by product type. A watch needs two pictures (as worn, and the
 * product shot) and its case width; glasses need one — the frame from the front, which the studio
 * lays on a face and uses in the size comparison too — and the frame's front width. The widths a
 * width may take match the widget's and the try-on page's parsers (a test keeps them equal).
 */
export type TryOnKind = 'watch' | 'glasses' | 'ring' | 'necklace' | 'earring' | 'bag';
export const TRYON_PRODUCT_TYPES = { watch: 'watch', eyewear: 'glasses', bag: 'bag' } as const satisfies Record<string, TryOnKind>;
/**
 * P5.4/P5.5: Jewelry covers rings, necklaces, earrings, bracelets… so a Jewelry product is a ring, a
 * necklace or an earring only once the merchant says which (the try-on settings' `category`).
 */
export const RING_PRODUCT_TYPE = 'jewelry';
export const TRYON_LISTED_TYPES = ['watch', 'eyewear', 'bag', RING_PRODUCT_TYPE] as const;
export const kindOf = (productType: string, category?: string | null): TryOnKind | null =>
  productType === RING_PRODUCT_TYPE ? (category === 'ring' || category === 'necklace' || category === 'earring' ? category : null) : (TRYON_PRODUCT_TYPES as Record<string, TryOnKind>)[productType] ?? null;
/** The kinds a Jewelry product can be marked as. */
export const JEWELRY_KINDS = ['ring', 'necklace', 'earring'] as const;
export type JewelryKind = (typeof JEWELRY_KINDS)[number];
export const WIDTH_MM: Record<TryOnKind, { min: number; max: number }> = { watch: { min: 5, max: 80 }, glasses: { min: 100, max: 170 }, ring: { min: 14, max: 30 }, necklace: { min: 60, max: 300 }, earring: { min: 5, max: 60 }, bag: { min: 100, max: 600 } };
/**
 * Where each kind's button may be published (the published config's rule): glasses on the face; a bag
 * wherever a bag's button goes, but not on the face or the wrist; everything else on the wrist.
 */
export const placementFitsKind = (kind: TryOnKind | null, placement: string): boolean =>
  kind === 'glasses' ? placement === 'face' : kind === 'bag' ? placement !== 'face' && placement !== 'wrist' : placement === 'wrist';

/** What a try-on still needs before it can go to the shop: its picture, a watch's product shot too, and its width. */
export function tryOnMissing(kind: TryOnKind, settings: { wornKey?: string | null; flatKey?: string | null; caseTenthsMm?: number | null } | null): ('worn' | 'flat' | 'case')[] {
  const missing: ('worn' | 'flat' | 'case')[] = [];
  if (!settings?.wornKey) missing.push('worn');
  if (kind === 'watch' && !settings?.flatKey) missing.push('flat');
  if (settings?.caseTenthsMm == null) missing.push('case');
  return missing;
}

export const SLOTS_OF: Record<TryOnKind, readonly ('worn' | 'flat')[]> = { watch: ['worn', 'flat'], glasses: ['worn'], ring: ['worn'], necklace: ['worn'], earring: ['worn'], bag: ['worn'] };

export const GLASSES_SLOT: { label: Bi; hint: Bi } = {
  label: { ar: 'الإطار من الأمام', en: 'The frame from the front' },
  hint: { ar: 'الإطار وحده من الأمام تمامًا بلا الذراعين، والعدسات شفافة، مقصوصًا بخلفية شفافة.', en: 'The frame alone, straight from the front, without the arms, clear lenses, cut out on a transparent background.' },
};
export const RING_SLOT: { label: Bi; hint: Bi } = {
  label: { ar: 'الخاتم كما يُلبس', en: 'The ring as worn' },
  hint: { ar: 'الخاتم من الأعلى كما يبدو على إصبع أو حامل، والحلقة عرضيًا، مقصوصًا بخلفية شفافة.', en: 'The ring from above as it looks on a finger or a stand, the band running across, cut out on a transparent background.' },
};
export const NECKLACE_SLOT: { label: Bi; hint: Bi } = {
  label: { ar: 'القلادة كما تُلبس', en: 'The necklace as worn' },
  hint: { ar: 'القلادة من الأمام على حامل أو عارضة، والسلاسل متدلية كما تُلبس، مقصوصة بخلفية شفافة.', en: 'The necklace from the front on a bust or a model, the chains hanging as worn, cut out on a transparent background.' },
};
export const EARRING_SLOT: { label: Bi; hint: Bi } = {
  label: { ar: 'القرط كما يُلبس', en: 'The earring as worn' },
  hint: { ar: 'قرط واحد من الأمام كما يتدلى من الأذن، مقصوصًا بخلفية شفافة.', en: 'One earring from the front as it hangs from the ear, cut out on a transparent background.' },
};
export const BAG_SLOT: { label: Bi; hint: Bi } = {
  label: { ar: 'الحقيبة من الأمام', en: 'The bag from the front' },
  hint: { ar: 'الحقيبة من الأمام والمقابض للأعلى، مقصوصة بخلفية شفافة.', en: 'The bag from the front, handles up, cut out on a transparent background.' },
};
export const WIDTH_LABEL: Record<TryOnKind, Bi> = { watch: { ar: 'عرض العلبة', en: 'Case width' }, glasses: { ar: 'عرض الإطار', en: 'Frame width' }, ring: { ar: 'عرض الخاتم', en: 'Ring width' }, necklace: { ar: 'العرض عند الرقبة', en: 'Width at the neck' }, earring: { ar: 'عرض القرط', en: 'Earring width' }, bag: { ar: 'عرض الحقيبة', en: 'Bag width' } };
/** The picture's name and hint for this kind: glasses have one, the frame from the front. */
export const slotInfo = (kind: TryOnKind, slot: 'worn' | 'flat') => (kind === 'glasses' ? GLASSES_SLOT : kind === 'ring' ? RING_SLOT : kind === 'necklace' ? NECKLACE_SLOT : kind === 'earring' ? EARRING_SLOT : kind === 'bag' ? BAG_SLOT : TRYON_SLOTS[slot]);
