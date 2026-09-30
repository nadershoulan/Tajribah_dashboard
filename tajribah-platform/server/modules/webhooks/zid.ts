/**
 * T61 — Zid's product webhooks, as a webhook source, from Zid's public documentation (docs.zid.sa,
 * read 2026-09-30); a real partner app confirms it.
 *
 * Zid webhooks are subscribed per store by the app (`connections/zid.ts`, when a store is linked), and
 * Zid signs nothing — it sends back the Basic-auth username and password given at subscription. So
 * each subscription gets its own: the username names the store and the event (`{store id}.{event}`),
 * and the password is our keyed hash of that username (the app secret, its own purpose). A delivery is
 * believed only when the password is ours for exactly that store and event — nothing is stored to
 * check it, and one store's credentials cannot speak for another's.
 *
 *  - **Topics**: `product.create` → `product.created`; `product.update` and `product.publish` →
 *    `product.updated`; `product.delete` → `product.deleted`.
 *  - **No event id**: the event, store, product and its change time identify a delivery.
 *  - The body is the product (Zid's product schema); a deletion's shape is not documented — its `id`
 *    is read, as for the others **(to confirm)**.
 */
import { timingSafeEqual } from '@/server/core/auth/crypto';
import { zidWebhookPassword, ZID_WEBHOOK_EVENTS } from '@/server/modules/connections/zid';
import type { Delivery, WebhookSource } from './sources';

export const ZID_TOPICS: Record<(typeof ZID_WEBHOOK_EVENTS)[number], string> = {
  'product.create': 'product.created',
  'product.update': 'product.updated',
  'product.publish': 'product.updated',
  'product.delete': 'product.deleted',
};

const enc = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `{store}.{event}` and the password from a Basic header, or null. */
function basic(headers: Headers): { store: string; event: keyof typeof ZID_TOPICS; username: string; password: string } | null {
  const value = /^Basic ([A-Za-z0-9+/=]{4,512})$/.exec(headers.get('authorization')?.trim() ?? '')?.[1];
  if (!value) return null;
  let decoded: string;
  try { decoded = new TextDecoder().decode(Uint8Array.from(atob(value), (c) => c.charCodeAt(0))); } catch { return null; }
  const colon = decoded.indexOf(':');
  if (colon < 0) return null;
  const username = decoded.slice(0, colon);
  const m = /^(\d{1,19})\.(.+)$/.exec(username);
  if (!m || !(m[2]! in ZID_TOPICS)) return null;
  return { store: m[1]!, event: m[2] as keyof typeof ZID_TOPICS, username, password: decoded.slice(colon + 1) };
}

export function zidSource(appSecret: string): WebhookSource {
  if (!appSecret) throw new Error('the Zid webhook source needs the app secret');
  return {
    provider: 'zid',
    async verify(_rawBody, headers) {
      const given = basic(headers);
      if (!given) return false;
      const expected = await zidWebhookPassword(appSecret, given.username);
      return given.password.length === expected.length && timingSafeEqual(enc.encode(given.password), enc.encode(expected));
    },
    parse(body, headers): Delivery | null {
      if (!body || typeof body !== 'object') return null;
      const b = body as { id?: unknown; product_id?: unknown; updated_at?: unknown };
      const id = typeof b.id === 'string' && UUID.test(b.id) ? b.id : typeof b.product_id === 'string' && UUID.test(b.product_id) ? b.product_id : null;
      if (!headers) return { eventId: '', topic: '', externalStoreId: '', subject: id }; // read again from the stored row
      const given = basic(headers);
      if (!given) return null;
      const stamp = typeof b.updated_at === 'string' ? b.updated_at : '';
      return { eventId: `${given.event}:${given.store}:${id ?? ''}:${stamp}`, topic: ZID_TOPICS[given.event], externalStoreId: given.store, subject: id };
    },
  };
}
