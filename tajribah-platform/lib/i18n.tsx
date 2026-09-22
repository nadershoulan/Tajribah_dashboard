'use client';

/**
 * P0.15 — the language context.
 *
 * Arabic is the default and RTL is the default layout (§11); English is the variant. The
 * choice lives in a cookie so the server renders the right direction on the first paint —
 * a dashboard that flips direction after hydration looks broken, and in RTL it looks very
 * broken.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_LANG, LANG_COOKIE, dirOf, type Bi, type Lang } from './lang';

export type LangValue = {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  setLang: (lang: Lang) => void;
  toggle: () => void;
  /** Inline bilingual string: `t('عربي', 'English')`. */
  t: (ar: string, en: string) => string;
  /** A `Bi` value from a data file or the database. */
  pick: (value: Bi) => string;
};

const LangContext = createContext<LangValue | null>(null);

export function LangProvider({ initial = DEFAULT_LANG, children }: { initial?: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    if (typeof document === 'undefined') return;
    document.documentElement.lang = next;
    document.documentElement.dir = dirOf(next);
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
    try { localStorage.setItem(LANG_COOKIE, next); } catch { /* private mode */ }
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = dirOf(lang);
  }, [lang]);

  const value = useMemo<LangValue>(() => ({
    lang,
    dir: dirOf(lang),
    setLang,
    toggle: () => setLang(lang === 'ar' ? 'en' : 'ar'),
    t: (ar, en) => (lang === 'ar' ? ar : en),
    pick: (bi) => (lang === 'ar' ? bi.ar : bi.en),
  }), [lang, setLang]);

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export function useLang(): LangValue {
  const value = useContext(LangContext);
  if (!value) throw new Error('useLang must be used inside <LangProvider>');
  return value;
}
