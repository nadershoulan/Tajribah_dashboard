/**
 * T69 — the website's GA4 measurement id, as staff set it in the admin console. The console publishes
 * it to Tajribah's config host (`/v1/_site/settings.json`) — the same public store products' configs
 * live in — so the website reads no database and needs no deploy when it changes.
 *
 * Server only (the page policy in `proxy.ts` and the root layout). Read at most once a minute per
 * server instance; if the config host cannot be reached, the last answer stands, and before any
 * answer the build's NEXT_PUBLIC_GA_ID does. "No id" from the console is an answer: analytics off.
 */
import { ENV_GA_ID, gaIdFromSettings } from './analytics';
import { CONFIG_BASE } from './tryon-config';

export const SITE_SETTINGS_URL = `${CONFIG_BASE}/_site/settings.json`;
const FRESH_MS = 60_000;
const TIMEOUT_MS = 1_500;

let known: { id: string | null; at: number } | null = null;

export async function siteGaId(fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<string | null> {
  if (known && now - known.at < FRESH_MS) return known.id;
  try {
    const response = await fetchImpl(SITE_SETTINGS_URL, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    // 404: the console has never saved one — the build's id, if any.
    const id = response.status === 404 ? ENV_GA_ID : response.ok ? gaIdFromSettings(await response.json()) : undefined;
    if (id !== undefined) { known = { id, at: now }; return id; }
  } catch { /* unreachable or slow: keep what we had */ }
  if (known) { known = { id: known.id, at: now }; return known.id; }
  return ENV_GA_ID;
}

/** Tests only: forget the last answer. */
export function forgetSiteSettings(): void { known = null; }
