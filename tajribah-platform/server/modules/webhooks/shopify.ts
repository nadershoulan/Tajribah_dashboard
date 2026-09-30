/**
 * P6 — Shopify's webhooks, as a webhook source: product changes the moment they happen (instead of
 * waiting for the hourly sync), an uninstall at once, and the three privacy topics Shopify requires
 * of every app it lists.
 *
 *  - **Signature**: `X-Shopify-Hmac-Sha256`, base64 HMAC-SHA256 of the raw body with the app secret.
 *    A bad one is refused with 401 and stored nowhere — as Shopify's own review checks.
 *  - **Envelope in the headers**: the topic (`X-Shopify-Topic`), the shop (`X-Shopify-Shop-Domain`)
 *    and the event (`X-Shopify-Event-Id`; `X-Shopify-Webhook-Id` for older deliveries, which a retry
 *    repeats). The body is the thing itself: a product, or `{ id }` for a deletion.
 *  - **Topics** map onto ours (`products/update` → `product.updated`, `app/uninstalled` →
 *    `app.uninstalled`); the privacy topics become `privacy.*` (`dispatch.ts`); anything else is
 *    stored under Shopify's own name and ignored.
 */
import { timingSafeEqual } from '@/server/core/auth/crypto';
import { SHOP_DOMAIN } from '@/server/connectors/shopify/connector';
import { hmacSha256, toBase64, type Delivery, type WebhookSource } from './sources';

export const SHOPIFY_TOPICS: Record<string, string> = {
  'products/create': 'product.created',
  'products/update': 'product.updated',
  'products/delete': 'product.deleted',
  'app/uninstalled': 'app.uninstalled',
  'customers/data_request': 'privacy.customer_data_request',
  'customers/redact': 'privacy.customer_redact',
  'shop/redact': 'privacy.shop_redact',
};

const enc = new TextEncoder();

export function shopifySource(secret: string): WebhookSource {
  if (!secret) throw new Error('the Shopify webhook source needs the app secret');
  return {
    provider: 'shopify',
    async verify(rawBody, headers) {
      const given = headers.get('x-shopify-hmac-sha256')?.trim() ?? '';
      if (!/^[A-Za-z0-9+/]{43}=$/.test(given)) return false; // a base64 SHA-256, or not worth comparing
      const expected = toBase64(await hmacSha256(secret, rawBody));
      return timingSafeEqual(enc.encode(given), enc.encode(expected));
    },
    parse(body, headers): Delivery | null {
      if (!body || typeof body !== 'object') return null;
      const id = (body as { id?: unknown }).id;
      const subject = typeof id === 'number' || (typeof id === 'string' && /^\d+$/.test(id)) ? String(id) : null;
      if (!headers) return { eventId: '', topic: '', externalStoreId: '', subject }; // read again from the stored row
      const topic = headers.get('x-shopify-topic') ?? '';
      const shop = (headers.get('x-shopify-shop-domain') ?? '').toLowerCase();
      const eventId = headers.get('x-shopify-event-id') ?? headers.get('x-shopify-webhook-id') ?? '';
      if (!topic || !SHOP_DOMAIN.test(shop) || !eventId) return null;
      const ours = SHOPIFY_TOPICS[topic] ?? topic;
      return { eventId, topic: ours, externalStoreId: shop, subject };
    },
  };
}
