/**
 * P1.2b — time-based one-time passwords (RFC 6238) and backup codes, on WebCrypto only.
 *
 *  - HMAC-SHA1, 30-second steps, 6 digits: what every authenticator app (Google, Microsoft,
 *    1Password, Authy) reads from an `otpauth://` URI without extra parameters.
 *  - One step either side is accepted, for a phone clock a little off. A step that was
 *    already used is refused (`afterStep`), so a code seen over a shoulder cannot be replayed
 *    inside its window.
 *  - Backup codes are random, shown once, and stored only as keyed hashes by the caller.
 */
import { foldDigits } from '@/lib/money';
import { timingSafeEqual } from './crypto';

export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;
/** Steps accepted either side of now. */
const WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

/** Spaces, dashes and lower case are what people type from a printed key; all accepted. */
export function base32Decode(text: string): Uint8Array {
  const clean = text.toUpperCase().replace(/[\s-]/g, '').replace(/=+$/, '');
  const out: number[] = [];
  let bits = 0;
  let value = 0;
  for (const char of clean) {
    const index = BASE32.indexOf(char);
    if (index < 0) throw new Error('not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** 160 bits, the size RFC 4226 recommends for HMAC-SHA1. */
export function newTotpSecret(): string {
  return base32Encode(crypto.getRandomValues(new Uint8Array(20)));
}

export const stepAt = (now = Date.now()): number => Math.floor(now / 1000 / TOTP_STEP_SECONDS);

/** The code for one time step (RFC 4226 §5.3 dynamic truncation). */
export async function totpCode(secret: string, step: number, digits = TOTP_DIGITS): Promise<string> {
  const key = await crypto.subtle.importKey('raw', base32Decode(secret) as BufferSource, { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const counter = new ArrayBuffer(8);
  const view = new DataView(counter);
  view.setUint32(0, Math.floor(step / 2 ** 32));
  view.setUint32(4, step >>> 0);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter));
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

/**
 * The step `code` belongs to, or null. Every step in the window is computed and compared
 * (constant time), so the answer takes the same time whichever step matched.
 */
export async function matchTotp(
  secret: string, code: string, options: { now?: number; afterStep?: number | null } = {},
): Promise<number | null> {
  const typed = foldDigits(code).replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const current = stepAt(options.now);
  let matched: number | null = null;
  const enc = new TextEncoder();
  for (let step = current - WINDOW; step <= current + WINDOW; step++) {
    const expected = await totpCode(secret, step);
    if (timingSafeEqual(enc.encode(expected), enc.encode(typed)) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (options.afterStep != null && matched <= options.afterStep) return null;
  return matched;
}

/** What the authenticator app scans. The issuer is shown next to the account in the app. */
export function otpauthUrl(input: { secret: string; account: string; issuer: string }): string {
  const label = encodeURIComponent(`${input.issuer}:${input.account}`);
  const params = new URLSearchParams({
    secret: input.secret, issuer: input.issuer, algorithm: 'SHA1', digits: String(TOTP_DIGITS), period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params}`;
}

// ------------------------------------------------------------------------ backup codes

/** No 0/o, 1/l/i: a code copied from paper must not be ambiguous. */
const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';
export const BACKUP_CODE_COUNT = 10;

/** `xxxx-xxxx`: 8 characters from 31, about 40 bits each — plenty behind a rate limit. */
export function newBackupCodes(count = BACKUP_CODE_COUNT): string[] {
  const codes = new Set<string>();
  // Rejection sampling: bytes ≥ 248 (8 × 31) are dropped so every character is equally likely.
  const limit = Math.floor(256 / BACKUP_ALPHABET.length) * BACKUP_ALPHABET.length;
  while (codes.size < count) {
    const chars: string[] = [];
    while (chars.length < 8) {
      for (const b of crypto.getRandomValues(new Uint8Array(16))) {
        if (b < limit && chars.length < 8) chars.push(BACKUP_ALPHABET[b % BACKUP_ALPHABET.length]);
      }
    }
    codes.add(`${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`);
  }
  return [...codes];
}

/** What gets hashed: lower case, no dash or spaces — so `ABCD EFGH` and `abcd-efgh` match. */
export function normaliseBackupCode(code: string): string {
  return code.toLowerCase().replace(/[\s-]/g, '');
}
