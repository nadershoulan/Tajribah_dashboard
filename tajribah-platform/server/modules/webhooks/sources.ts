/**
 * P1.7 — who may send us webhooks, and how to tell a real delivery from a forged one.
 *
 * A source verifies the signature over the **raw body**, the exact bytes that were signed
 * (§13.6): re-serialising parsed JSON changes whitespace and key order, and a check over
 * that is either always false or, worse, checks something other than what was sent. It
 * then maps the provider's envelope onto our canonical topics.
 *
 * The providers: Shopify (`shopify.ts`) and Salla (`salla.ts`, T61 — from Salla's public
 * documentation; a real partner app confirms it in P1.4). The mechanics are also tested with a
 * source built from `hmacSource`.
 */
import type { Provider } from '@/db/schema';
import { timingSafeEqual } from '@/server/core/auth/crypto';

/** What we act on. Providers' own topic names are mapped onto these. */
export const TOPICS = ['product.created', 'product.updated', 'product.deleted', 'app.uninstalled'] as const;
export type Topic = (typeof TOPICS)[number];

export type Delivery = {
  /** The provider's id for this delivery — the dedup key. */
  eventId: string;
  /** Canonical, or the provider's own name when we do not handle it (stored, then ignored). */
  topic: Topic | string;
  /** Which store sent it: `store_connections.external_store_id`. */
  externalStoreId: string;
  /** The product (or other thing) the event is about, when there is one. */
  subject: string | null;
};

export interface WebhookSource {
  readonly provider: Provider;
  verify(rawBody: string, headers: Headers): Promise<boolean>;
  /**
   * The delivery, or null when the body is not an envelope this source understands. `headers` are
   * the request's when it arrives; a stored event is read again later without them (its topic,
   * event id and store are on the row by then — only `subject` is read again).
   */
  parse(body: unknown, headers?: Headers): Delivery | null;
  /**
   * What is stored of the body, when not all of it may be (T61: Salla sends a store's access and
   * refresh tokens inside `app.store.authorize` — they are never written to the events table).
   */
  redact?(body: unknown): unknown;
}

/**
 * HMAC-SHA256 over the raw body, hex, in `header`. Compared in constant time; a missing or
 * malformed header is a failed check, never an exception.
 */
export function hmacSource(options: {
  provider: Provider;
  secret: string;
  header: string;
  parse: (body: unknown) => Delivery | null;
}): WebhookSource {
  if (!options.secret) throw new Error(`webhook source ${options.provider} needs a secret`);
  return {
    provider: options.provider,
    parse: options.parse,
    async verify(rawBody, headers) {
      const given = headers.get(options.header)?.trim().toLowerCase() ?? '';
      if (!/^[0-9a-f]{64}$/.test(given)) return false;
      const expected = await hmacSha256(options.secret, rawBody);
      return timingSafeEqual(fromHex(given), expected);
    },
  };
}

export async function hmacSha256(secret: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message)));
}

export const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
export const toHex = (bytes: Uint8Array) => [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
const fromHex = (hex: string) => new Uint8Array(hex.match(/../g)!.map((h) => parseInt(h, 16)));

const registry = new Map<string, WebhookSource>();

export function registerWebhookSource(source: WebhookSource): void {
  registry.set(source.provider, source);
}

/** Null for a provider we do not accept webhooks from — the route answers 404. */
export function webhookSourceFor(provider: string): WebhookSource | null {
  return registry.get(provider) ?? null;
}

/** Tests only. */
export function clearWebhookSources(): void {
  registry.clear();
}
