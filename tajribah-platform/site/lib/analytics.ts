/**
 * T68 — site analytics: Google Analytics 4 with Consent Mode v2, the website only (never the try-on
 * frame, the phone capture page or a store's product page — those are the merchant's shoppers).
 *
 * Nothing is measured until the visitor accepts in the banner: Google's script is not even fetched
 * before then (PDPL: consent for non-essential cookies). Advertising signals stay denied whatever the
 * choice. Live only once a GA4 measurement id is set — by staff in the admin console (T69), or the
 * NEXT_PUBLIC_GA_ID build variable as the fallback; without one there is no banner, no footer link,
 * nothing loads, and the policy pages say there is no analytics.
 *
 * No 'use client': the page policy (`proxy.ts`) and the policy texts read these on the server too.
 */

/** A GA4 measurement id, e.g. G-AB12CD34EF. Anything else is ignored. */
export function measurementId(raw: string | undefined): string | null {
  return raw && /^G-[A-Z0-9]{4,16}$/.test(raw.trim()) ? raw.trim() : null;
}

// The build inlines NEXT_PUBLIC_* only when it is set; unset, `process` may not exist in the browser.
function fromEnv(): string | undefined {
  try {
    return process.env.NEXT_PUBLIC_GA_ID;
  } catch {
    return undefined;
  }
}

/**
 * The id the build was given, if any. T69: staff set the live one in the admin console, and the website
 * reads it at run time (`lib/site-settings.ts`) — this is only the fallback, and what the static
 * preview uses. Pages read the live one with `useGaId()` (`lib/analytics-context.tsx`).
 */
export const ENV_GA_ID = measurementId(fromEnv());

/** What the admin console publishes for the website (`_site/settings.json` on the config host). */
export function gaIdFromSettings(body: unknown): string | null | undefined {
  if (typeof body !== 'object' || body === null) return undefined;
  const { v, ga4 } = body as { v?: unknown; ga4?: unknown };
  if (v !== 1) return undefined;
  return ga4 === null ? null : typeof ga4 === 'string' ? measurementId(ga4) : undefined;
}

/** Where GA4 sends and loads from — allowed by the page policy only when analytics is on. */
export const GA_SCRIPT_HOST = 'https://www.googletagmanager.com';
export const GA_CONNECT = ['https://*.google-analytics.com', 'https://*.analytics.google.com', GA_SCRIPT_HOST];

/** The visitor's choice, kept in this browser for 12 months, then asked again. */
export const CONSENT_KEY = 'tajribah-consent';
export const CONSENT_DAYS = 365;
export type Choice = 'granted' | 'denied';

export function readChoice(stored: string | null, now = Date.now()): Choice | null {
  if (!stored) return null;
  try {
    const { choice, at } = JSON.parse(stored) as { choice?: unknown; at?: unknown };
    if ((choice !== 'granted' && choice !== 'denied') || typeof at !== 'number') return null;
    return now - at < CONSENT_DAYS * 86_400_000 ? choice : null;
  } catch {
    return null;
  }
}

export const storedChoice = (choice: Choice, now = Date.now()) => JSON.stringify({ choice, at: now });

/** Consent Mode v2: everything denied until the visitor accepts; then analytics only, never ads. */
export const CONSENT_DEFAULT = { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' } as const;
export const CONSENT_GRANTED = { ...CONSENT_DEFAULT, analytics_storage: 'granted' } as const;

/** GA4's own settings: no Google signals, no ad personalisation, its cookies last 12 months. */
export const GA_CONFIG = { allow_google_signals: false, allow_ad_personalization_signals: false, cookie_expires: CONSENT_DAYS * 86_400 } as const;
