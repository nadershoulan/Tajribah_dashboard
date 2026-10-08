/**
 * T115 — Cloudflare Turnstile, checked on the server: the browser's token is worth nothing until Cloudflare's
 * siteverify says it is good, for our hostnames, for the action this form named, and not used before (Cloudflare
 * refuses a reused token). Without a secret in production the form refuses to send rather than accept bots.
 *
 * T120 — the same check guards sign-in and sign-up (`requireHuman`), each with its own action, so a token earned
 * on one form is refused on another.
 */
import { loadEnv } from '@/server/core/config/env';
import { errors } from '@/server/core/errors/problem';
import { log } from '@/server/core/observability/log';

export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_ACTION = 'contact';
export type TurnstileAction = 'contact' | 'login' | 'register';

export type TurnstileVerdict = { ok: true } | { ok: false; reason: string };
export type TurnstileVerifier = (token: string, ip: string | null, action?: TurnstileAction) => Promise<TurnstileVerdict>;

export function turnstileVerifier(secret: string, hostnames: string[], fetchImpl: typeof fetch = (...a) => fetch(...a)): TurnstileVerifier {
  return async (token, ip, action = TURNSTILE_ACTION) => {
    if (!token || token.length > 2048) return { ok: false, reason: 'no token' };
    const form = new FormData();
    form.set('secret', secret);
    form.set('response', token);
    if (ip) form.set('remoteip', ip);
    let body: { success?: boolean; hostname?: string; action?: string; 'error-codes'?: string[] };
    try {
      const response = await fetchImpl(SITEVERIFY, { method: 'POST', body: form });
      body = await response.json();
    } catch {
      return { ok: false, reason: 'turnstile unreachable' };
    }
    if (!body.success) return { ok: false, reason: `turnstile: ${(body['error-codes'] ?? ['failed']).join(',')}` };
    if (hostnames.length && (!body.hostname || !hostnames.includes(body.hostname))) return { ok: false, reason: `turnstile: hostname ${body.hostname}` };
    if (body.action !== action) return { ok: false, reason: `turnstile: action ${body.action}` };
    return { ok: true };
  };
}

/** The hostnames a token may come from (the deployment's own; empty on this computer: any). */
export function siteHosts(): string[] {
  return (process.env.SITE_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
}

/**
 * T120 — refuse a sign-in or sign-up the browser did not earn a Turnstile token for. With no secret configured it
 * passes on this computer and in tests, and refuses in production (a missing setting must not open the door).
 * A refusal is a validation error on `turnstileToken`, before the password is even looked at.
 */
export async function requireHuman(token: string | undefined, ip: string | null, action: TurnstileAction, fetchImpl?: typeof fetch): Promise<void> {
  const env = loadEnv();
  if (!env.TURNSTILE_SECRET_KEY) {
    if (env.NODE_ENV === 'production') throw errors.notImplemented('the security check is not set up yet (TURNSTILE_SECRET_KEY)');
    return;
  }
  const verdict = await turnstileVerifier(env.TURNSTILE_SECRET_KEY, siteHosts(), fetchImpl)(token ?? '', ip, action);
  if (!verdict.ok) {
    log.info('turnstile refused', { action, reason: verdict.reason });
    throw errors.validation({ turnstileToken: ['the security check did not pass — please try it again'] });
  }
}
