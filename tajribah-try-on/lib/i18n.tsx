'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

import { LANG_COOKIE, type Lang } from './lang';

export { LANG_COOKIE, pick, type Bi, type Lang } from './lang';

/**
 * Arabic is the default everywhere. English is an opt-in that is remembered in
 * a cookie (so the server renders the right language on the next visit) and in
 * localStorage (so the static preview, which has no server, remembers it too).
 */
type LangValue = {
  lang: Lang;
  dir: 'rtl' | 'ltr';
  setLang: (next: Lang) => void;
  toggle: () => void;
  /** Arabic first, always. */
  t: <T>(ar: T, en: T) => T;
};

const LangContext = createContext<LangValue>({
  lang: 'ar',
  dir: 'rtl',
  setLang: () => {},
  toggle: () => {},
  t: (ar) => ar,
});

export function readStoredLang(): Lang | null {
  try {
    const v = window.localStorage.getItem(LANG_COOKIE);
    return v === 'en' || v === 'ar' ? v : null;
  } catch {
    return null;
  }
}

export function LangProvider({ initial = 'ar', children }: { initial?: Lang; children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initial);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = lang;
    root.dir = lang === 'ar' ? 'rtl' : 'ltr';
  }, [lang]);

  const setLang = useCallback((next: Lang) => {
    setLangState(next);
    try {
      window.localStorage.setItem(LANG_COOKIE, next);
    } catch {
      /* private mode: the choice lasts for this page only */
    }
    document.cookie = `${LANG_COOKIE}=${next}; path=/; max-age=31536000; samesite=lax`;
  }, []);

  const value = useMemo<LangValue>(
    () => ({
      lang,
      dir: lang === 'ar' ? 'rtl' : 'ltr',
      setLang,
      toggle: () => setLang(lang === 'ar' ? 'en' : 'ar'),
      t: <T,>(ar: T, en: T) => (lang === 'ar' ? ar : en),
    }),
    [lang, setLang],
  );

  return <LangContext.Provider value={value}>{children}</LangContext.Provider>;
}

export const useLang = () => useContext(LangContext);
