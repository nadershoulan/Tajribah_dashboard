/**
 * Identifier and token primitives. WebCrypto only — no dependency (T4).
 *
 * Primary keys are uuid v7: the first 48 bits are the millisecond timestamp, so rows
 * insert in time order and index locality stays good as a table grows. v4 scatters.
 */

const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, '0'));

// The last millisecond an id was minted in, and the sequence within it (RFC 9562 §6.2, method 1: rand_a as a counter).
let lastMs = -1;
let seq = 0;

/**
 * RFC 9562 uuid v7. Time-ordered; safe to expose. **Strictly increasing within one process**: ids minted in the same
 * millisecond count up in the 12 bits after the timestamp (starting from a random point in the lower half, so a
 * thousand-odd ids fit before the next millisecond is borrowed). Lists ordered by id — "newest first" — are then exact
 * even for rows made in the same instant (T133: a test saw two same-millisecond products swap places).
 * A time earlier than the last (a clock step back, or a test minting an old id) gets its own random sequence and keeps
 * the time it was given.
 */
export function uuidv7(now: number = Date.now()): string {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  let ms = now;
  let counter: number;
  if (ms === lastMs || (ms < lastMs && ms > lastMs - 2)) {
    // the same millisecond (or one just borrowed): count up; past 12 bits, borrow the next millisecond
    ms = lastMs;
    seq++;
    if (seq > 0xfff) { lastMs++; ms = lastMs; seq = ((b[6]! << 8) | b[7]!) & 0x7ff; }
    counter = seq;
  } else if (ms > lastMs) {
    lastMs = ms;
    seq = ((b[6]! << 8) | b[7]!) & 0x7ff;
    counter = seq;
  } else {
    counter = ((b[6]! << 8) | b[7]!) & 0xfff;
  }
  b[0] = Math.floor(ms / 2 ** 40) & 0xff;
  b[1] = Math.floor(ms / 2 ** 32) & 0xff;
  b[2] = Math.floor(ms / 2 ** 24) & 0xff;
  b[3] = Math.floor(ms / 2 ** 16) & 0xff;
  b[4] = Math.floor(ms / 2 ** 8) & 0xff;
  b[5] = ms & 0xff;
  b[6] = 0x70 | (counter >> 8); // version 7, then the counter's top 4 bits
  b[7] = counter & 0xff;
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = HEX;
  return (
    h[b[0]] + h[b[1]] + h[b[2]] + h[b[3]] + '-' +
    h[b[4]] + h[b[5]] + '-' + h[b[6]] + h[b[7]] + '-' +
    h[b[8]] + h[b[9]] + '-' +
    h[b[10]] + h[b[11]] + h[b[12]] + h[b[13]] + h[b[14]] + h[b[15]]
  );
}

/**
 * P2.9 — the same uuid for the same inputs (RFC 9562 v8, from SHA-256). For references that
 * are not rows — "Starter's grant for October 2026" — so a unique index can refuse the second
 * one. Never for primary keys, and never for anything secret: it is guessable by design.
 */
export async function stableUuid(...parts: string[]): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('\u001f'))));
  const b = digest.slice(0, 16);
  b[6] = (b[6] & 0x0f) | 0x80; // version 8
  b[8] = (b[8] & 0x3f) | 0x80; // variant 10xx
  const h = HEX;
  return (
    h[b[0]] + h[b[1]] + h[b[2]] + h[b[3]] + '-' + h[b[4]] + h[b[5]] + '-' + h[b[6]] + h[b[7]] + '-' +
    h[b[8]] + h[b[9]] + '-' + h[b[10]] + h[b[11]] + h[b[12]] + h[b[13]] + h[b[14]] + h[b[15]]
  );
}

/** The millisecond timestamp a v7 id was minted at. Useful in tests and admin tooling. */
export function uuidv7Time(id: string): number {
  return parseInt(id.slice(0, 8) + id.slice(9, 13), 16);
}

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

const ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789'; // no l/o/0/1 — these get read aloud

/**
 * A URL-safe random token. Used for QR short codes, invitation links and share slugs.
 * Not for anything whose only protection is secrecy of a short string — use `secret()`.
 */
export function shortCode(length = 10): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (const byte of bytes) out += ALPHABET[byte % ALPHABET.length];
  return out;
}

/** 256 bits of entropy, base64url. Refresh tokens, API keys, verification links. */
export function secret(bytes = 32): string {
  const b = new Uint8Array(bytes);
  crypto.getRandomValues(b);
  return base64url(b);
}

export function base64url(bytes: Uint8Array): string {
  let bin = '';
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64url(value: string): Uint8Array {
  const bin = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
