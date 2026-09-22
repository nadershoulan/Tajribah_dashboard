/**
 * P0.7 — the crypto primitives. WebCrypto only, no dependency (T4).
 *
 * Read this file carefully once rather than trusting it implicitly: it is the whole reason
 * there is no auth library here.
 *
 * Password hashes carry their own parameters (`pbkdf2$sha256$600000$salt$hash`), so the
 * algorithm can change later without a migration or a forced reset — `needsRehash` tells
 * the login path when to upgrade a hash it just verified (T3).
 */

const enc = new TextEncoder();

// ---------------------------------------------------------------------------- passwords

const PBKDF2_ITERATIONS = 600_000; // OWASP 2023 for PBKDF2-HMAC-SHA256
const PBKDF2_KEY_BITS = 256;

function toB64(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let bin = '';
  for (const byte of view) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function fromB64(value: string): Uint8Array {
  const bin = atob(value);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as unknown as BufferSource, iterations, hash: 'SHA-256' },
    key,
    PBKDF2_KEY_BITS,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$sha256$${PBKDF2_ITERATIONS}$${toB64(salt)}$${toB64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2' || parts[1] !== 'sha256') return false;
  const iterations = Number(parts[2]);
  if (!Number.isFinite(iterations) || iterations < 1) return false;
  const salt = fromB64(parts[3]);
  const expected = fromB64(parts[4]);
  const actual = await pbkdf2(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

/** True when a verified hash used weaker parameters than we now require. Rehash on login. */
export function needsRehash(stored: string): boolean {
  const parts = stored.split('$');
  if (parts.length !== 5 || parts[0] !== 'pbkdf2') return true;
  return Number(parts[2]) < PBKDF2_ITERATIONS;
}

export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

// -------------------------------------------------------------------------------- HMAC

function b64url(bytes: Uint8Array): string {
  return toB64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(value: string): Uint8Array {
  return fromB64(value.replace(/-/g, '+').replace(/_/g, '/'));
}

async function hmacKey(secret: string, usage: KeyUsage[] = ['sign']): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, usage);
}

export async function hmac(secret: string, message: string): Promise<string> {
  const key = await hmacKey(secret);
  return b64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(message))));
}

/**
 * A keyed, domain-separated hash. Used for OTP codes, refresh tokens and invitation
 * tokens: a plain SHA-256 of six digits is not a hash, it is a lookup table (§13.6). The
 * purpose string means a value hashed for one use cannot be replayed into another.
 */
export async function keyedHash(secret: string, purpose: string, value: string): Promise<string> {
  return hmac(secret, `${purpose}:${value}`);
}

// --------------------------------------------------------------------------------- JWT

export type JwtClaims = {
  /** User id. */
  sub: string;
  /** Session id — the refresh-token family this access token belongs to. */
  sid: string;
  /** Tenant the session is currently acting for; null before one is chosen. */
  tid?: string | null;
  iat: number;
  exp: number;
};

/** What a caller supplies; `iat` and `exp` are set here, never by the caller. */
export type JwtInput = Omit<JwtClaims, 'iat' | 'exp'>;

/**
 * HS256. Access tokens only — short-lived, held in memory by the client, never in
 * localStorage or a readable cookie (§13.6).
 */
export async function signJwt(claims: JwtInput, secret: string, ttlSeconds: number): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtClaims = { ...claims, iat: now, exp: now + ttlSeconds };
  const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const signature = await hmac(secret, `${header}.${body}`);
  return `${header}.${body}.${signature}`;
}

export type JwtResult =
  | { ok: true; claims: JwtClaims }
  | { ok: false; reason: 'malformed' | 'bad_signature' | 'expired' };

export async function verifyJwt(token: string, secret: string, now = Date.now()): Promise<JwtResult> {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [header, body, signature] = parts;

  const expected = await hmac(secret, `${header}.${body}`);
  if (!timingSafeEqual(fromB64url(signature), fromB64url(expected))) {
    return { ok: false, reason: 'bad_signature' };
  }

  let claims: JwtClaims;
  try {
    claims = JSON.parse(new TextDecoder().decode(fromB64url(body))) as JwtClaims;
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  // The header is checked after the signature: an unsigned token never gets this far, so
  // `alg: none` cannot be smuggled in.
  try {
    const parsed = JSON.parse(new TextDecoder().decode(fromB64url(header))) as { alg?: string };
    if (parsed.alg !== 'HS256') return { ok: false, reason: 'malformed' };
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= now) return { ok: false, reason: 'expired' };
  return { ok: true, claims };
}

// ------------------------------------------------------------------ secrets at rest

/**
 * AES-256-GCM for provider tokens (§7.5). The key comes from `ENCRYPTION_KEY`, which is
 * domain-separated from `AUTH_SECRET`: one secret, one job.
 */
async function aesKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.digest('SHA-256', enc.encode(secret));
  return crypto.subtle.importKey('raw', material, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptSecret(plaintext: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await aesKey(secret);
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as unknown as BufferSource }, key, enc.encode(plaintext),
  );
  return `v1.${b64url(iv)}.${b64url(new Uint8Array(ciphertext))}`;
}

export async function decryptSecret(envelope: string, secret: string): Promise<string | null> {
  const [version, ivPart, dataPart] = envelope.split('.');
  if (version !== 'v1' || !ivPart || !dataPart) return null;
  try {
    const key = await aesKey(secret);
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromB64url(ivPart) as unknown as BufferSource },
      key,
      fromB64url(dataPart) as unknown as BufferSource,
    );
    return new TextDecoder().decode(plain);
  } catch {
    return null; // wrong key or tampered ciphertext — indistinguishable on purpose
  }
}

// -------------------------------------------------------------------------- utilities

/** A 6-digit OTP. Rejection sampling, so every code is equally likely. */
export function otpCode(digits = 6): string {
  const max = 10 ** digits;
  const limit = Math.floor(0xffffffff / max) * max;
  const buffer = new Uint32Array(1);
  let value: number;
  do {
    crypto.getRandomValues(buffer);
    value = buffer[0];
  } while (value >= limit);
  return String(value % max).padStart(digits, '0');
}

/** Salted so it cannot be brute-forced back to the address (§13.6). */
export async function hashIp(ip: string | null | undefined, secret: string): Promise<string | null> {
  if (!ip) return null;
  return keyedHash(secret, 'ip', ip);
}
