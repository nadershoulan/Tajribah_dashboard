/**
 * Light or dark for the dashboard and the staff console. The device decides unless the person picks
 * one: no choice → no `data-theme` on <html>, and the stylesheets follow `prefers-color-scheme`; a
 * choice → `data-theme="light" | "dark"`, which wins. Kept in a cookie, like the language, so the
 * server writes it on the first paint — no flash, and no inline script for the page policy to allow.
 * No 'use client': the layout reads it on the server.
 */
export type ThemeChoice = 'system' | 'light' | 'dark';

export const THEME_COOKIE = 'tajribah-theme';
export const THEME_CHOICES: ThemeChoice[] = ['system', 'light', 'dark'];

/** What the person picked; anything else (none, tampered) is the device's choice. */
export function themeFromCookie(cookieHeader: string | null | undefined): ThemeChoice {
  const found = new RegExp(`(?:^|;\\s*)${THEME_COOKIE}=(light|dark)(?:;|$)`).exec(cookieHeader ?? '');
  return (found?.[1] as ThemeChoice | undefined) ?? 'system';
}

/** The `data-theme` attribute for a choice: none for the device's own. */
export const themeAttribute = (choice: ThemeChoice): 'light' | 'dark' | undefined => (choice === 'system' ? undefined : choice);

/** The cookie that keeps a choice — a year; the device's choice clears it. */
export function themeCookie(choice: ThemeChoice): string {
  return choice === 'system'
    ? `${THEME_COOKIE}=; path=/; max-age=0; samesite=lax`
    : `${THEME_COOKIE}=${choice}; path=/; max-age=31536000; samesite=lax`;
}
