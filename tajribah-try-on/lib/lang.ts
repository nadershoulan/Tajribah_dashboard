/**
 * Language primitives with no 'use client' directive, so server files (the
 * root layout, route metadata) can import real values from here. Importing a
 * constant from a client module on the server yields a client reference, not
 * the value.
 */
export type Lang = 'ar' | 'en';
export type Bi = { ar: string; en: string };

export const LANG_COOKIE = 'tajribah-lang';
export const DEFAULT_LANG: Lang = 'ar';

export const pick = (b: Bi, lang: Lang) => (lang === 'ar' ? b.ar : b.en);

/** Read the language cookie from a raw Cookie header. Arabic unless English was chosen. */
export function langFromCookie(cookieHeader: string | null | undefined): Lang {
  return new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=en(?:;|$)`).test(cookieHeader ?? '') ? 'en' : DEFAULT_LANG;
}
