/**
 * P8 — the developer page's facts. Every one of them is the platform's (tajribah-platform:
 * `lib/public-api/v1.ts`, `lib/api-keys.ts`, `lib/webhooks.ts`, `server/modules/outgoing-webhooks`);
 * `widget/__tests__/developers.test.ts` there holds this file equal to them, and runs the signature
 * example below against a real signature.
 */
import type { Bi } from './i18n';
import { COMPANY } from './site';

export const API = {
  base: `${COMPANY.appUrl}/api/v1`,
  reference: `${COMPANY.appUrl}/api/v1/openapi.json`,
  keyPrefix: 'tjr_',
  ratePerMinute: 600,
  signatureHeader: 'tajribah-signature',
  retryHours: 21,
  timeoutSeconds: 10,
} as const;

export type Endpoint = { method: 'GET'; path: string; scope: string; what: Bi };

export const ENDPOINTS: Endpoint[] = [
  { method: 'GET', path: '/api/v1/products', scope: 'products:read', what: { ar: 'منتجاتك، الأحدث أولًا، صفحة بعد صفحة (limit حتى 200، وcursor للصفحة التالية).', en: 'Your products, newest first, page by page (limit up to 200; cursor for the next page).' } },
  { method: 'GET', path: '/api/v1/products/{id}', scope: 'products:read', what: { ar: 'منتج واحد.', en: 'One product.' } },
  { method: 'GET', path: '/api/v1/models', scope: 'models:read', what: { ar: 'نماذجك ثلاثية الأبعاد، الأحدث تعديلًا أولًا.', en: 'Your 3D models, most recently changed first.' } },
  { method: 'GET', path: '/api/v1/analytics', scope: 'analytics:read', what: { ar: 'أرقام متجرك خلال 7 أو 30 أو 90 يومًا (range).', en: 'Your store’s figures over 7, 30 or 90 days (range).' } },
];

export const EVENTS: { name: string; what: Bi }[] = [
  { name: 'product.created', what: { ar: 'أُضيف منتج في تجربة.', en: 'A product was added in Tajribah.' } },
  { name: 'product.updated', what: { ar: 'عُدّل منتج في تجربة.', en: 'A product was changed in Tajribah.' } },
  { name: 'product.deleted', what: { ar: 'حُذف منتج (يحمل معرّفه فقط).', en: 'A product was deleted (it carries only its id).' } },
  { name: 'model.published', what: { ar: 'نُشر نموذج ثلاثي الأبعاد.', en: 'A 3D model was published.' } },
  { name: 'ai_job.finished', what: { ar: 'انتهى عمل للذكاء الاصطناعي: اكتمل أو تعذّر أو أُلغي.', en: 'An AI job ended: done, failed or cancelled.' } },
];

export const CURL_EXAMPLE = `curl "${COMPANY.appUrl}/api/v1/products?limit=20" \\
  -H "Authorization: Bearer ${'tjr_'}…"`;

/** Node.js: check that a webhook came from Tajribah. Run as-is by the platform's test. */
export const VERIFY_EXAMPLE = `const { createHmac, timingSafeEqual } = require('node:crypto');

// header: the tajribah-signature header; rawBody: the body exactly as it arrived.
function verify(secret, header, rawBody, toleranceSeconds = 300) {
  const parts = Object.fromEntries(header.split(',').map((part) => part.split('=')));
  const t = Number(parts.t);
  if (!t || Math.abs(Date.now() / 1000 - t) > toleranceSeconds) return false;
  const expected = createHmac('sha256', secret).update(t + '.' + rawBody).digest();
  const given = Buffer.from(parts.v1 || '', 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}`;
