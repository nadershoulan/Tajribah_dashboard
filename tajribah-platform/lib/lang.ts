/**
 * Language primitives with no 'use client' directive, so server files can import real
 * values from here. Importing a constant from a client module on the server yields a
 * client reference, not the value.
 */
export type Lang = 'ar' | 'en';
export type Bi = { ar: string; en: string };

export const LANG_COOKIE = 'tajribah-lang';
export const DEFAULT_LANG: Lang = 'ar';
export const LANGS: Lang[] = ['ar', 'en'];

export const dirOf = (lang: Lang): 'rtl' | 'ltr' => (lang === 'ar' ? 'rtl' : 'ltr');
export const pick = (value: Bi, lang: Lang): string => (lang === 'ar' ? value.ar : value.en);

/** Arabic unless English was explicitly chosen (§11 — RTL is the default, LTR the variant). */
export function langFromCookie(cookieHeader: string | null | undefined): Lang {
  return new RegExp(`(?:^|;\\s*)${LANG_COOKIE}=en(?:;|$)`).test(cookieHeader ?? '') ? 'en' : DEFAULT_LANG;
}
