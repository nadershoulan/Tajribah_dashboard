/**
 * T61 — Salla's webhooks, as a webhook source, from Salla's public documentation (docs.salla.dev,
 * read 2026-09-30); a real partner app confirms or corrects it (P1.4).
 *
 *  - **Signature**: the `Signature` strategy (Salla's default for partner apps) — `X-Salla-Signature`,
 *    hex HMAC-SHA256 of the raw body with the app's webhook secret (`SALLA_WEBHOOK_SECRET`).
 *  - **Envelope in the body**: `{ event, merchant, created_at, data }`. The store is `merchant` (the
 *    id Salla's user-info answer gives for the store); the product is `data.id`.
 *  - **No event id**: Salla sends none, so the dedup key is the event, the store, the thing and the
 *    time it was stamped — a redelivery repeats all four. Two changes to one product in the same
 *    second are one delivery here; each queues a fresh read of the product, so nothing is lost.
 *  - **Topics** map onto ours. Salla is replacing `product.updated` with finer events
 *    (`product.price.updated`, `product.status.updated`, `product.image.updated`, …): every one of
 *    them is a product change. `app.uninstalled` → `app.uninstalled`. Anything else is stored under
 *    Salla's own name and ignored.
 *  - **Tokens are never stored with the event**: `app.store.authorize` carries the store's access and
 *    refresh tokens. `capture` hands them to the connection (or, for a store not linked yet, to the
 *    sealed waiting grant — `connections/salla.ts`); what is kept of the event has them blanked.
 */
import { hmacSha256, toHex, type Delivery, type WebhookSource } from './sources';
import { timingSafeEqual } from '@/server/core/auth/crypto';
import { forgetSallaGrant, receiveSallaAuthorize } from '@/server/modules/connections/salla';

export const SALLA_PRODUCT_CHANGES = [
  'product.updated', 'product.available', 'product.price.updated', 'product.status.updated', 'product.image.updated',
  'product.category.updated', 'product.brand.updated', 'product.tags.updated', 'product.channels.changed',
];

/** `product.created`, `product.deleted` and `app.uninstalled` are already our names; the changes become one. */
export const sallaTopic = (event: string): string => (SALLA_PRODUCT_CHANGES.includes(event) ? 'product.updated' : event);

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const numeric = (v: unknown) => (typeof v === 'number' && Number.isSafeInteger(v) && v > 0) || (typeof v === 'string' && /^\d{1,19}$/.test(v));
const enc = new TextEncoder();

export function sallaSource(secret: string): WebhookSource {
  if (!secret) throw new Error('the Salla webhook source needs the webhook secret');
  return {
    provider: 'salla',
    async verify(rawBody, headers) {
      const given = headers.get('x-salla-signature')?.trim().toLowerCase() ?? '';
      if (!/^[0-9a-f]{64}$/.test(given)) return false;
      const expected = toHex(await hmacSha256(secret, rawBody));
      return timingSafeEqual(enc.encode(given), enc.encode(expected));
    },
    parse(body): Delivery | null {
      if (!isObj(body) || typeof body.event !== 'string' || !body.event || !numeric(body.merchant)) return null;
      const data = isObj(body.data) ? body.data : {};
      const topic = sallaTopic(body.event);
      const subject = topic.startsWith('product.') && numeric(data.id) ? String(data.id) : null;
      const stamped = typeof body.created_at === 'string' ? body.created_at : '';
      const merchant = String(body.merchant);
      return { eventId: `${body.event}:${merchant}:${subject ?? ''}:${stamped}`, topic, externalStoreId: merchant, subject };
    },
    async capture(body, requestId) {
      if (!isObj(body)) return;
      if (body.event === 'app.store.authorize') await receiveSallaAuthorize(body.merchant, body.data, requestId);
      if (body.event === 'app.uninstalled') await forgetSallaGrant(body.merchant);
    },
    redact(body) {
      if (!isObj(body) || body.event !== 'app.store.authorize' || !isObj(body.data)) return body;
      return { ...body, data: { ...body.data, access_token: '[redacted]', refresh_token: '[redacted]' } };
    },
  };
}
