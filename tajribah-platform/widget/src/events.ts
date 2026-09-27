/**
 * P4.1 — the analytics event contract, version 1.
 *
 * This file is the one place that decides **what may leave a shopper's browser**. It ships
 * inside the storefront widget, so it has no dependencies; the collector (P4.2) validates the
 * same shapes with zod in `lib/contracts/analytics.ts`, which imports the constants from here
 * so the two cannot drift.
 *
 * The plan's privacy rule (§7.10) is not a policy note, it is this function: no IP address, no
 * raw user agent, no cross-site identifier, no shopper identity. The widget cannot send one
 * even by accident, because `sanitize()` drops every field it was not asked for, caps the rest,
 * and refuses property values that look like a person (an email address, a long run of digits).
 *
 * `session` is a random token the browser makes for one tab session and forgets when the tab
 * closes. It is **not** an id: the collector salts and hashes it with a key that rotates every
 * 24 hours before it is stored (§7.10), so it cannot join two days together.
 */

export const EVENT_SCHEMA_VERSION = 1;

/** Exactly the event types the ClickHouse `events` table declares (§7.10). */
export const EVENT_TYPES = [
  'product_view',
  'ar_open',
  'ar_place',
  'tryon_start',
  'tryon_capture',
  'add_to_cart',
  'purchase',
] as const;

export type EventType = (typeof EVENT_TYPES)[number];

/** Limits. Small on purpose: a batch has to fit in one `sendBeacon`, which browsers cap at 64 KB. */
export const LIMITS = {
  /**
   * Flush once this many events are queued — which is also the most that can ever be waiting,
   * because a flush always empties the queue, delivered or not (see `track.ts`).
   */
  batch: 20,
  /** Flush a partial batch after this long. */
  flushMs: 5_000,
  /** A product id as the merchant's platform spells it. */
  productId: 64,
  /** `properties` — a few short strings, nothing more. */
  props: 8,
  propKey: 24,
  propValue: 64,
  /** Guards against a page that loops: a duration longer than an hour is a bug, not a session. */
  durationMs: 60 * 60 * 1000,
  /** A basket, in minor units of the store's currency. */
  value: 100_000_000,
  /** The whole body. Well under the beacon cap, with room for the envelope. */
  bodyBytes: 16 * 1024,
} as const;

/** What a caller passes to `track()`. Everything but the type is optional. */
export type TrackInput = {
  type: string;
  productId?: string | null;
  durationMs?: number | null;
  /** Minor units (halalas), like every other amount in this codebase. */
  valueMinor?: number | null;
  currency?: string | null;
  arSupported?: boolean | null;
  properties?: Record<string, unknown> | null;
};

/** What goes on the wire. `t` is milliseconds since the batch was opened, not a clock reading. */
export type WireEvent = {
  type: EventType;
  /** Offset in ms from the batch's `sentAt`, so no event carries an absolute local clock. */
  t: number;
  productId?: string;
  durationMs?: number;
  valueMinor?: number;
  currency?: string;
  arSupported?: 0 | 1;
  properties?: Record<string, string>;
};

export type EventBatch = {
  v: typeof EVENT_SCHEMA_VERSION;
  /** The merchant's public store key, from the script tag. */
  store: string;
  /** One tab session's random token — salted and hashed by the collector before storage. */
  session: string;
  /** The widget that sent it, so a bad release can be found. */
  sdk: string;
  /** Epoch ms at send. The collector trusts its own clock and uses this only to order a batch. */
  sentAt: number;
  events: WireEvent[];
};

const isType = (v: unknown): v is EventType => typeof v === 'string' && (EVENT_TYPES as readonly string[]).includes(v);

const clean = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string') return undefined;
  // Control characters out; a value is one short line of text or nothing.
  const s = v.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  return s.length > 0 && s.length <= max ? s : undefined;
};

const whole = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v) : undefined;

/**
 * Does this string look like it identifies a person? Deliberately blunt, and applied only to
 * `properties`, which is the one field a merchant fills in themselves. An email address or a
 * run of seven or more digits (a phone number, an order's payment reference, an IBAN fragment)
 * is dropped rather than sent — losing a property is a smaller mistake than shipping identity.
 */
export function looksPersonal(value: string): boolean {
  if (/[^\s@]+@[^\s@]+\.[^\s@]+/.test(value)) return true;
  if (/\d[\d\s-]{6,}/.test(value.replace(/[^\d\s-]/g, ''))) return true;
  return false;
}

/** Property keys are the merchant's own vocabulary, in a shape a column can hold. */
const propKey = (k: string): string | undefined =>
  /^[a-z][a-z0-9_]{0,23}$/.test(k) ? k : undefined;

/**
 * The event as it may be sent, or `null` when it may not be. Never throws: this runs inside
 * someone else's shop, where an exception is the merchant's problem, not ours.
 */
export function sanitize(input: unknown, t: number): WireEvent | null {
  try {
    if (typeof input !== 'object' || input === null) return null;
    const raw = input as TrackInput;
    if (!isType(raw.type)) return null;

    const event: WireEvent = { type: raw.type, t: whole(t, 0, 24 * 60 * 60 * 1000) ?? 0 };

    const productId = clean(raw.productId, LIMITS.productId);
    if (productId) event.productId = productId;

    const durationMs = whole(raw.durationMs, 0, LIMITS.durationMs);
    if (durationMs !== undefined) event.durationMs = durationMs;

    const valueMinor = whole(raw.valueMinor, 0, LIMITS.value);
    if (valueMinor !== undefined) event.valueMinor = valueMinor;

    // ISO 4217, as the store spells it; anything else is not a currency.
    const currency = clean(raw.currency, 3);
    if (currency && /^[A-Za-z]{3}$/.test(currency)) event.currency = currency.toUpperCase();

    if (typeof raw.arSupported === 'boolean') event.arSupported = raw.arSupported ? 1 : 0;

    if (raw.properties && typeof raw.properties === 'object') {
      const out: Record<string, string> = {};
      let n = 0;
      for (const [k, v] of Object.entries(raw.properties)) {
        if (n >= LIMITS.props) break;
        const key = propKey(k);
        const value = clean(typeof v === 'number' || typeof v === 'boolean' ? String(v) : v, LIMITS.propValue);
        if (!key || !value || looksPersonal(value)) continue;
        out[key] = value;
        n += 1;
      }
      if (n > 0) event.properties = out;
    }

    return event;
  } catch {
    return null;
  }
}
