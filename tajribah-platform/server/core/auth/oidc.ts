/**
 * P8 — an OpenID Connect client for single sign-on (authorization code flow with PKCE), built on
 * WebCrypto so it runs in a Worker. It trusts nothing it has not checked:
 *
 *  - **Discovery** (`/.well-known/openid-configuration`): the document must name exactly the issuer
 *    asked for, and every endpoint must be https — a provider that is not what it says is refused
 *    before anyone is sent to it.
 *  - **PKCE (S256)** and a **nonce** on every sign-in: a stolen code is useless without the verifier,
 *    and an ID token minted for another sign-in is refused.
 *  - **The ID token** is verified with the provider's published keys (JWKS): RS256 or ES256 only —
 *    never `none`, never HMAC (a client secret is not a signing key here) — then its issuer,
 *    audience (and `azp` when there are several), expiry, issue time and nonce.
 *
 * Plain http is allowed only for a provider on this machine, and only when a caller says so (the
 * live test); nothing in the app ever does.
 */
import { timingSafeEqual } from './crypto';

export type OidcProvider = { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string };
export type OidcOptions = { fetch?: typeof fetch; allowLocalHttp?: boolean };
export type IdTokenClaims = { iss: string; sub: string; aud: string | string[]; exp: number; iat: number; nonce?: string; azp?: string; email?: string; email_verified?: boolean; name?: string };

export class OidcError extends Error {}

const enc = new TextEncoder();
const dec = new TextDecoder();
const SKEW_SECONDS = 120;
const JWKS_TTL_MS = 5 * 60_000;

export const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromB64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((text.length + 3) % 4)), (c) => c.charCodeAt(0));
const randomToken = (bytes = 32) => b64url(crypto.getRandomValues(new Uint8Array(bytes)));

function safeUrl(value: unknown, what: string, options: OidcOptions): string {
  if (typeof value !== 'string') throw new OidcError(`${what}: missing`);
  let url: URL;
  try { url = new URL(value); } catch { throw new OidcError(`${what}: not an address`); }
  const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
  if (url.protocol !== 'https:' && !(options.allowLocalHttp && local && url.protocol === 'http:')) throw new OidcError(`${what}: must be https`);
  return value;
}

/** The issuer as configured: an https address, no trailing slash, no query. */
export function normaliseIssuer(input: string, options: OidcOptions = {}): string {
  const issuer = safeUrl(input.trim(), 'issuer', options).replace(/\/+$/, '');
  if (/[?#]/.test(issuer)) throw new OidcError('issuer: no query or fragment');
  return issuer;
}

const discoveryCache = new Map<string, { provider: OidcProvider; at: number }>();

export async function discover(issuer: string, options: OidcOptions = {}, now = Date.now()): Promise<OidcProvider> {
  const cached = discoveryCache.get(issuer);
  if (cached && now - cached.at < JWKS_TTL_MS) return cached.provider;
  const response = await (options.fetch ?? fetch)(`${issuer}/.well-known/openid-configuration`, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new OidcError(`discovery: ${response.status}`);
  const doc = await response.json() as Record<string, unknown>;
  // OIDC Discovery §4.3: the issuer in the document must be identical to the one asked for.
  if (doc.issuer !== issuer && doc.issuer !== `${issuer}/`) throw new OidcError('discovery: the provider names another issuer');
  const provider: OidcProvider = {
    issuer: String(doc.issuer),
    authorization_endpoint: safeUrl(doc.authorization_endpoint, 'authorization_endpoint', options),
    token_endpoint: safeUrl(doc.token_endpoint, 'token_endpoint', options),
    jwks_uri: safeUrl(doc.jwks_uri, 'jwks_uri', options),
  };
  discoveryCache.set(issuer, { provider, at: now });
  return provider;
}

/** A fresh sign-in's secrets: `state` (this browser), `nonce` (this token), PKCE verifier and challenge. */
export async function signInSecrets(): Promise<{ state: string; nonce: string; verifier: string; challenge: string }> {
  const verifier = randomToken(32);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(verifier))));
  return { state: randomToken(24), nonce: randomToken(24), verifier, challenge };
}

export function authorizeUrl(provider: OidcProvider, input: { clientId: string; redirectUri: string; state: string; nonce: string; challenge: string }): string {
  const url = new URL(provider.authorization_endpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('code_challenge', input.challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

/** The code, once, for tokens (client_secret_basic, as OIDC assumes by default). */
export async function exchangeCode(provider: OidcProvider, input: { code: string; verifier: string; redirectUri: string; clientId: string; clientSecret: string }, options: OidcOptions = {}): Promise<string> {
  const basic = btoa(`${encodeURIComponent(input.clientId)}:${encodeURIComponent(input.clientSecret)}`);
  const response = await (options.fetch ?? fetch)(provider.token_endpoint, {
    method: 'POST',
    headers: { authorization: `Basic ${basic}`, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', code: input.code, redirect_uri: input.redirectUri, code_verifier: input.verifier }).toString(),
  });
  const body = await response.json().catch(() => ({})) as { id_token?: string; error?: string };
  if (!response.ok || typeof body.id_token !== 'string') throw new OidcError(`token: ${response.status} ${body.error ?? 'no id_token'}`);
  return body.id_token;
}

type Jwk = JsonWebKey & { kid?: string; use?: string; alg?: string };
const jwksCache = new Map<string, { keys: Jwk[]; at: number }>();

async function keysOf(jwksUri: string, options: OidcOptions, fresh: boolean, now: number): Promise<Jwk[]> {
  const cached = jwksCache.get(jwksUri);
  if (!fresh && cached && now - cached.at < JWKS_TTL_MS) return cached.keys;
  const response = await (options.fetch ?? fetch)(jwksUri, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new OidcError(`jwks: ${response.status}`);
  const keys = ((await response.json()) as { keys?: Jwk[] }).keys;
  if (!Array.isArray(keys)) throw new OidcError('jwks: no keys');
  jwksCache.set(jwksUri, { keys, at: now });
  return keys;
}

const ALGS: Record<string, { import: RsaHashedImportParams | EcKeyImportParams; verify: AlgorithmIdentifier | EcdsaParams; kty: string }> = {
  RS256: { import: { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, verify: { name: 'RSASSA-PKCS1-v1_5' }, kty: 'RSA' },
  ES256: { import: { name: 'ECDSA', namedCurve: 'P-256' }, verify: { name: 'ECDSA', hash: 'SHA-256' } as EcdsaParams, kty: 'EC' },
};

/** Verify `idToken` from `provider` for `clientId` and this sign-in's `nonce`. Returns its claims. */
export async function verifyIdToken(idToken: string, input: { provider: OidcProvider; clientId: string; nonce: string }, options: OidcOptions = {}, now = Date.now()): Promise<IdTokenClaims> {
  const parts = idToken.split('.');
  if (parts.length !== 3) throw new OidcError('id_token: malformed');
  const [h, p, s] = parts as [string, string, string];
  let header: { alg?: string; kid?: string };
  let claims: IdTokenClaims;
  try {
    header = JSON.parse(dec.decode(fromB64url(h)));
    claims = JSON.parse(dec.decode(fromB64url(p)));
  } catch { throw new OidcError('id_token: malformed'); }
  const alg = ALGS[header.alg ?? ''];
  if (!alg) throw new OidcError(`id_token: algorithm ${header.alg} is not accepted`);

  const pick = (keys: Jwk[]) => keys.filter((k) => k.kty === alg.kty && (!k.use || k.use === 'sig') && (!k.alg || k.alg === header.alg) && (header.kid ? k.kid === header.kid : true));
  let candidates = pick(await keysOf(input.provider.jwks_uri, options, false, now));
  if (!candidates.length) candidates = pick(await keysOf(input.provider.jwks_uri, options, true, now)); // the provider rotated its keys
  if (candidates.length !== 1) throw new OidcError(candidates.length ? 'id_token: which key signed it is ambiguous' : 'id_token: no published key signed it');
  const key = await crypto.subtle.importKey('jwk', candidates[0]!, alg.import, false, ['verify']);
  const valid = await crypto.subtle.verify(alg.verify, key, fromB64url(s), enc.encode(`${h}.${p}`));
  if (!valid) throw new OidcError('id_token: bad signature');

  const seconds = Math.floor(now / 1000);
  if (claims.iss !== input.provider.issuer) throw new OidcError('id_token: another issuer');
  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audiences.includes(input.clientId)) throw new OidcError('id_token: not for this client');
  if (audiences.length > 1 && claims.azp !== input.clientId) throw new OidcError('id_token: issued to another party');
  if (typeof claims.exp !== 'number' || claims.exp + SKEW_SECONDS < seconds) throw new OidcError('id_token: expired');
  if (typeof claims.iat !== 'number' || claims.iat - SKEW_SECONDS > seconds) throw new OidcError('id_token: issued in the future');
  if (typeof claims.nonce !== 'string' || !timingSafeEqual(enc.encode(claims.nonce), enc.encode(input.nonce))) throw new OidcError('id_token: minted for another sign-in');
  if (typeof claims.sub !== 'string' || !claims.sub) throw new OidcError('id_token: no subject');
  return claims;
}

/** Tests only. */
export function clearOidcCaches(): void {
  discoveryCache.clear();
  jwksCache.clear();
}
