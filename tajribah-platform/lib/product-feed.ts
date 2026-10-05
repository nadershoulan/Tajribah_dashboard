/**
 * Products from a feed or a file, for a store that does not link its platform: a Google Merchant
 * Center feed (RSS 2.0 or Atom with the `g:` attributes — what Salla's "Google Merchant" app and most
 * platforms publish), or a spreadsheet with the same columns (CSV, TSV; XLSX through `lib/xlsx.ts`).
 *
 * What is read (Google's attribute names; common plain names are accepted for a hand-made sheet):
 *   id · title · description · link · image_link · additional_image_link · price · availability ·
 *   item_group_id · mpn/sku/gtin · product_width / product_height / product_length (T72: the size, when
 *   the feed has it — "20 cm", "8 in", "200 mm"; a plain number is millimetres, the dashboard's unit) ·
 *   product_type / google_product_category (T77: the store's own category, read for the product's type)
 * Variants (rows sharing `item_group_id`) are one product: the try-on does not change per size or
 * colour. Its first row names it. `price` is the regular price ("60.00 SAR"); a sale price is the
 * shop's business, not the size's. A row without an id or a title is skipped and reported.
 * Arabic titles are kept as the Arabic name as well as the name (a feed comes in one language).
 */
import { minorDigits } from './money';

export type FeedProduct = {
  externalId: string;
  sku: string | null;
  name: string;
  nameAr: string | null;
  description: string | null;
  priceMinor: number | null;
  currency: string;
  images: { url: string }[];
  link: string | null;
  /** Millimetres, when the feed gives them; only ever fills a size the product does not have yet. */
  dimensions: { widthMm?: number; heightMm?: number; depthMm?: number } | null;
  /** T77: the type the store's own category names, or null; only ever fills a type still "other". */
  productType: FeedProductType | null;
  /** T77: the store's own category, as written ("ساعات نسائية"), or null — the store's, kept as it changes. */
  category: string | null;
};

export type FeedProductType = 'watch' | 'jewelry' | 'eyewear' | 'bag' | 'apparel' | 'furniture';

export type FeedResult = { products: FeedProduct[]; skipped: { row: number; reason: string }[]; rows: number };

export const FEED_MAX_BYTES = 30 * 1024 * 1024;
export const FEED_MAX_ROWS = 50_000;
const DEFAULT_CURRENCY = 'SAR';

/** Column names a hand-made sheet may use for Google's attributes (lower-cased, spaces → _). */
const ALIASES: Record<string, string> = {
  id: 'id', product_id: 'id', item_id: 'id', 'رقم_المنتج': 'id', 'المعرف': 'id',
  title: 'title', name: 'title', product_name: 'title', 'الاسم': 'title', 'اسم_المنتج': 'title',
  description: 'description', 'الوصف': 'description',
  link: 'link', url: 'link', product_url: 'link', 'الرابط': 'link',
  image_link: 'image_link', image: 'image_link', image_url: 'image_link', 'الصورة': 'image_link',
  additional_image_link: 'additional_image_link', additional_image_links: 'additional_image_link',
  price: 'price', 'السعر': 'price',
  item_group_id: 'item_group_id', group_id: 'item_group_id',
  mpn: 'sku', sku: 'sku', gtin: 'gtin', 'رمز_المنتج': 'sku',
  product_width: 'product_width', width: 'product_width', width_mm: 'product_width', 'العرض': 'product_width',
  product_height: 'product_height', height: 'product_height', height_mm: 'product_height', 'الارتفاع': 'product_height',
  product_length: 'product_length', length: 'product_length', depth: 'product_length', length_mm: 'product_length', depth_mm: 'product_length', 'الطول': 'product_length', 'العمق': 'product_length',
  currency: 'currency', 'العملة': 'currency',
  product_type: 'product_type', category: 'product_type', product_category: 'product_type', 'التصنيف': 'product_type', 'الفئة': 'product_type', 'القسم': 'product_type',
  google_product_category: 'google_product_category',
};

/**
 * T77 — the product's type from the store's own category (`product_type`, then Google's
 * `google_product_category` when written out as text), in Arabic or English. Only words that name one
 * type are read: "ساعات نسائية" → watch, "خواتم نسائية" / "حلق" / "سلاسل" / "Jewelry > Rings" → jewelry.
 * A word that could be either (طقم "a set", إكسسوار "accessories") names nothing — the type stays
 * "other" for the merchant to choose. Watches come first: "a watch with a bracelet" is a watch.
 */
/** Arabic stems that must begin a word (after "ال", "و" or "ب" at most — "سوار" is not inside "إكسسوارات"), and whole English words. */
const words = (arabic: string[], english: string[]) =>
  new RegExp(`(?<![\\u0600-\\u06FF])(?:ال|و|ب)?(?:${arabic.join('|')})|\\b(?:${english.join('|')})\\b`, 'i');
const TYPE_WORDS: [FeedProductType, RegExp][] = [
  ['watch', words(['ساع[ةا]'], ['watch(es)?', 'smartwatch(es)?'])],
  ['eyewear', words(['نظار[ةا]'], ['(sun)?glasses', 'eyewear', 'eyeglasses'])],
  ['bag', words(['حقيب[ةا]', 'حقائب', 'شنط'], ['(hand)?bags?', 'purses?', 'backpacks?'])],
  ['apparel', words(['ملابس', 'فستان', 'فساتين', 'عباي[ةا]', 'حجاب', 'طرح[ةه]', 'طرحات', 'قميص', 'بنطلون'], ['apparel', 'clothing', 'dress(es)?', 'shirts?', 'abayas?', 'hijabs?'])],
  ['jewelry', words(['خاتم', 'خواتم', 'حلق', 'أقراط', 'اقراط', 'قرط', 'سلسال', 'سلاسل', 'قلاد[ةا]', 'قلائد', 'تعليق[ةه]', 'تشوكر', 'أساور', 'اساور', 'سوار', 'خلخال', 'خلاخل', 'مجوهرات'], ['jewel(le)?ry', 'rings?', 'necklaces?', 'earrings?', 'bracelets?', 'anklets?', 'pendants?', 'chokers?'])],
  ['furniture', words(['أثاث', 'اثاث', 'كنب'], ['furniture', 'sofas?', 'couch(es)?'])],
];

/** The store's category as one name: the last step of a path ("Apparel > Jewelry > Rings" → "Rings"), 100 characters at most. */
export function categoryOf(text: string): string | null {
  const last = decodeXml(text).split('>').map((part) => part.trim()).filter(Boolean).pop();
  return last && !/^\d+$/.test(last) ? last.slice(0, 100) : null; // a bare Google taxonomy number names nothing readable
}

export function typeFromCategory(text: string): FeedProductType | null {
  // A path is read from its most specific step: "Apparel & Accessories > Jewelry > Rings" is jewelry.
  const steps = decodeXml(text).split('>').map((step) => step.trim()).filter(Boolean).reverse();
  for (const step of steps) {
    const found = TYPE_WORDS.find(([, pattern]) => pattern.test(step));
    if (found) return found[0];
  }
  return null;
}

/**
 * T85 — which piece of jewelry a name or category names, for the dashboard's try-on preview to start
 * from (the merchant can change it; nothing is saved). Earrings before rings: "earrings" is its own word.
 */
const JEWELRY_WORDS: ['earring' | 'necklace' | 'ring', RegExp][] = [
  ['earring', words(['حلق', 'أقراط', 'اقراط', 'قرط'], ['earrings?'])],
  ['necklace', words(['سلسال', 'سلاسل', 'قلاد[ةا]', 'قلائد', 'تعليق[ةه]', 'تشوكر'], ['necklaces?', 'pendants?', 'chokers?'])],
  ['ring', words(['خاتم', 'خواتم'], ['rings?'])],
];
export function jewelryKindOf(text: string): 'earring' | 'necklace' | 'ring' | null {
  return JEWELRY_WORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

const ARABIC = /[\u0600-\u06FF]/;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decodeXml(text: string): string {
  return text
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : whole;
      }
      return ENTITIES[code.toLowerCase()] ?? whole;
    });
}

/** "60.00 SAR", "SAR 60", "60,5", "1,250.00 ر.س" → minor units and currency; null when unreadable. */
export function parsePrice(text: string, fallbackCurrency = DEFAULT_CURRENCY): { minor: number; currency: string } | null {
  const folded = text.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/\u066B/g, '.').trim();
  if (!folded) return null;
  const currency = (/\b([A-Z]{3})\b/.exec(folded)?.[1]) ?? (/ر\.?\s?س/.test(folded) ? 'SAR' : fallbackCurrency);
  const number = /(\d[\d,]*(?:\.\d+)?|\d+(?:,\d{1,2})?)/.exec(folded)?.[1];
  if (!number) return null;
  // "1,250.00" (thousands) vs "60,5" (decimal comma): a comma followed by exactly 1–2 digits at the end is a decimal.
  const normal = /,\d{1,2}$/.test(number) && !number.includes('.') ? number.replace(',', '.') : number.replace(/,/g, '');
  const value = Number(normal);
  if (!Number.isFinite(value) || value < 0) return null;
  const minor = Math.round(value * 10 ** minorDigits(currency));
  return minor <= 2_147_483_647 ? { minor, currency } : null;
}

/** "20 cm", "8 in", "200mm", "0.3 m", "20 سم" (Arabic digits too), "45" (mm) → millimetres; null when unreadable or not a sane size. */
export function parseLength(text: string): number | null {
  const folded = text.replace(/[\u0660-\u0669]/g, (d) => String(d.charCodeAt(0) - 0x660)).replace(/\u066B|,/g, '.').trim().toLowerCase();
  const m = /^(\d+(?:\.\d+)?)\s*(mm|cm|m|in|inch|inches|"|مم|سم|م)?$/.exec(folded);
  if (!m) return null;
  const factor: Record<string, number> = { mm: 1, 'مم': 1, cm: 10, 'سم': 10, m: 1000, 'م': 1000, in: 25.4, inch: 25.4, inches: 25.4, '"': 25.4 };
  const mm = Math.round(Number(m[1]) * factor[m[2] ?? 'mm']! * 10) / 10;
  return mm > 0 && mm <= 3000 ? mm : null;
}

type Row = Record<string, string[]>;

/** One record (a feed item or a sheet row, keys already normalised) → a product, or why not. */
function productOf(row: Row): FeedProduct | string {
  const one = (k: string) => (row[k]?.find((v) => v.trim()) ?? '').trim();
  const id = one('id');
  const title = one('title');
  if (!id) return 'no id';
  if (!title) return 'no title';
  const price = one('price') ? parsePrice(one('price'), one('currency') || DEFAULT_CURRENCY) : null;
  const images = [...(row.image_link ?? []), ...(row.additional_image_link ?? []).flatMap((v) => v.split(','))]
    .map((u) => u.trim()).filter((u) => /^https:\/\/\S+$/i.test(u));
  return {
    externalId: (one('item_group_id') || id).slice(0, 200),
    sku: (one('sku') || one('gtin') || null)?.slice(0, 100) ?? null,
    name: title.slice(0, 200),
    nameAr: ARABIC.test(title) ? title.slice(0, 200) : null,
    description: one('description') ? one('description').slice(0, 5000) : null,
    priceMinor: price?.minor ?? null,
    currency: price?.currency ?? DEFAULT_CURRENCY,
    images: [...new Set(images)].slice(0, 10).map((url) => ({ url })),
    link: /^https?:\/\//i.test(one('link')) ? one('link') : null,
    dimensions: dimensionsOf(one),
    productType: typeFromCategory(one('product_type')) ?? typeFromCategory(one('google_product_category')),
    category: categoryOf(one('product_type') || one('google_product_category')),
  };
}

function dimensionsOf(one: (k: string) => string): FeedProduct['dimensions'] {
  const out: NonNullable<FeedProduct['dimensions']> = {};
  const w = parseLength(one('product_width')), h = parseLength(one('product_height')), d = parseLength(one('product_length'));
  if (w) out.widthMm = w;
  if (h) out.heightMm = h;
  if (d) out.depthMm = d;
  return Object.keys(out).length ? out : null;
}

function collect(rows: Row[], firstRow: number): FeedResult {
  const byId = new Map<string, FeedProduct>();
  const skipped: FeedResult['skipped'] = [];
  rows.forEach((row, i) => {
    const product = productOf(row);
    if (typeof product === 'string') { if (skipped.length < 50) skipped.push({ row: i + firstRow, reason: product }); return; }
    if (!byId.has(product.externalId)) byId.set(product.externalId, product); // a variant of a product already read
  });
  return { products: [...byId.values()], skipped, rows: rows.length };
}

const keyOf = (name: string) => {
  const k = name.trim().toLowerCase().replace(/^g:/, '').replace(/[\s-]+/g, '_');
  return ALIASES[k] ?? k;
};

/** A Google Merchant XML feed: RSS `<item>` or Atom `<entry>` elements, attributes with or without `g:`. */
export function parseXmlFeed(xml: string): FeedResult {
  const items = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/g)].slice(0, FEED_MAX_ROWS).map((m) => m[2]!);
  const rows = items.map((body) => {
    const row: Row = {};
    for (const m of body.matchAll(/<([a-zA-Z_:][\w:.-]*)\b[^>]*?(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
      const tag = m[1]!;
      // Atom's <link href="…"/> carries its address in the attribute.
      const value = m[2] !== undefined ? decodeXml(m[2]).trim() : tag === 'link' ? (/href="([^"]*)"/.exec(m[0])?.[1] ?? '') : '';
      (row[keyOf(tag)] ??= []).push(value);
    }
    return row;
  });
  return collect(rows, 1);
}

/** RFC 4180 rows: quoted fields may hold the delimiter, quotes ("" ) and line breaks. */
export function splitDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; }
      else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((v) => v !== '')) rows.push(row);
      row = [];
      if (rows.length > FEED_MAX_ROWS) break;
    } else field += c;
  }
  row.push(field);
  if (row.some((v) => v !== '')) rows.push(row);
  return rows;
}

/** A sheet as rows of cells, its first row the column names. */
export function parseTable(table: string[][]): FeedResult {
  const [head, ...body] = table;
  if (!head) return { products: [], skipped: [], rows: 0 };
  const keys = head.map(keyOf);
  const rows = body.slice(0, FEED_MAX_ROWS).map((cells) => {
    const row: Row = {};
    keys.forEach((k, i) => { if (cells[i] !== undefined) (row[k] ??= []).push(cells[i]!); });
    return row;
  });
  return collect(rows, 2);
}

/** CSV or TSV text: the delimiter is the one the header line uses most (tab, comma or semicolon). */
export function parseDelimited(text: string): FeedResult {
  const clean = text.replace(/^\uFEFF/, '');
  const header = clean.split(/\r?\n/, 1)[0] ?? '';
  const delimiter = ['\t', ',', ';'].map((d) => [d, header.split(d).length] as const).sort((a, b) => b[1] - a[1])[0]![0];
  return parseTable(splitDelimited(clean, delimiter));
}

/** Whichever the text is: XML (a feed) or a delimited sheet. */
export function parseFeedText(text: string): FeedResult {
  const start = text.replace(/^\uFEFF/, '').trimStart();
  return start.startsWith('<') ? parseXmlFeed(start) : parseDelimited(start);
}

/** Why a feed cannot be used, in the merchant's terms, or null. */
export function feedProblem(result: FeedResult): string | null {
  if (result.rows === 0) return 'no products found — it should be a Google Merchant feed, or a sheet whose first row names the columns (id, title, price, image_link…)';
  if (result.products.length === 0) return `none of its ${result.rows} rows has both an id and a title`;
  return null;
}
