/**
 * Store slugs.
 *
 * §13.6: never derive a store URL slug from an Arabic store name without showing the
 * merchant the result. Latin transliteration of Arabic is ambiguous — "مجوهرات النور" can
 * become `mjwhrat-alnwr`, which looks like a typo on an invoice and in a URL the merchant
 * will read aloud to a customer.
 *
 * So: this returns `null` when a name produces nothing usable, and the caller must then
 * offer a generated slug and show it before saving. `null` is not a failure, it is a
 * question for the merchant.
 */
import { shortCode } from './ids';

const RESERVED = new Set([
  'admin', 'api', 'app', 'dashboard', 'www', 'cdn', 'static', 'assets', 'auth', 'login',
  'signup', 'billing', 'support', 'help', 'status', 'docs', 'blog', 'tajribah', 'tryon',
  'ar', 'en', 'new', 'settings', 'account', 'me',
]);

/** ASCII-only slug, or null when the name has no Latin content to work with. */
export function slugify(name: string): string | null {
  const slug = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/g, '');

  if (slug.length < 3) return null;
  if (RESERVED.has(slug)) return null;
  return slug;
}

/** A readable fallback when `slugify` gives up. Shown to the merchant, never applied silently. */
export function generatedSlug(prefix = 'store'): string {
  return `${prefix}-${shortCode(6)}`;
}

export function isReserved(slug: string): boolean {
  return RESERVED.has(slug);
}

/** `taken` comes from the database; the caller appends until it finds room. */
export function nextAvailable(base: string, taken: Set<string>): string {
  if (!taken.has(base) && !RESERVED.has(base)) return base;
  for (let n = 2; n < 100; n++) {
    const candidate = `${base}-${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return generatedSlug(base.slice(0, 12));
}
