/**
 * T115 — API-200 POST /api/contact: the website's contact form. Same origin only; everything else is in
 * `service.ts` (rate limit, trap field, checks, Turnstile, then the database).
 */
import { route } from '@/server/core/observability/request';
import { apiConfig, assertSameOrigin, json } from '@/server/core/http/api';
import { loadEnv } from '@/server/core/config/env';
import { submitContact } from './service';
import { turnstileVerifier } from './turnstile';

export const contactHandler = route(async (request) => {
  const config = apiConfig();
  assertSameOrigin(request, config);
  const env = loadEnv();
  const hosts = (process.env.SITE_HOSTS ?? '').split(',').map((h) => h.trim()).filter(Boolean);
  const body = await request.json().catch(() => null);
  await submitContact(body, {
    ip: request.headers.get('cf-connecting-ip'),
    userAgent: request.headers.get('user-agent'),
  }, {
    verify: env.TURNSTILE_SECRET_KEY ? turnstileVerifier(env.TURNSTILE_SECRET_KEY, hosts) : null,
    requireTurnstile: env.NODE_ENV === 'production',
    hashKey: env.AUTH_SECRET,
  });
  // Kept or caught by the trap, the answer is the same: a bot learns nothing.
  return json({ ok: true }, { status: 201 });
});
