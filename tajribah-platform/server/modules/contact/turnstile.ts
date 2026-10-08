/**
 * T115 — Cloudflare Turnstile, checked on the server: the browser's token is worth nothing until Cloudflare's
 * siteverify says it is good, for our hostnames, for the action this form named, and not used before (Cloudflare
 * refuses a reused token). Without a secret in production the form refuses to send rather than accept bots.
 */
export const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
export const TURNSTILE_ACTION = 'contact';

export type TurnstileVerdict = { ok: true } | { ok: false; reason: string };
export type TurnstileVerifier = (token: string, ip: string | null) => Promise<TurnstileVerdict>;

export function turnstileVerifier(secret: string, hostnames: string[], fetchImpl: typeof fetch = (...a) => fetch(...a)): TurnstileVerifier {
  return async (token, ip) => {
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
    if (body.action !== TURNSTILE_ACTION) return { ok: false, reason: `turnstile: action ${body.action}` };
    return { ok: true };
  };
}
