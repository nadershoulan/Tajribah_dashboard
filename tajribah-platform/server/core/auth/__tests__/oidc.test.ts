/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P8 — the OIDC client. ID tokens here are signed with node:crypto keys, independently of the code
 * under test; every way a token can be wrong is tried: another key, `none`, HMAC with the client
 * secret, another issuer or audience, several audiences without `azp`, expired, from the future,
 * another sign-in's nonce, no subject; a key rotation is followed; discovery must name its issuer.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createHmac, generateKeyPairSync, sign as nodeSign, type KeyObject } from 'node:crypto';
import { OidcError, authorizeUrl, clearOidcCaches, discover, exchangeCode, normaliseIssuer, signInSecrets, verifyIdToken, type OidcProvider } from '@/server/core/auth/oidc';

const ISSUER = 'https://idp.example.com';
const CLIENT = 'tajribah-client';
const b64u = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

function keyPair(kind: 'rsa' | 'ec', kid: string) {
  const { privateKey, publicKey } = kind === 'rsa'
    ? generateKeyPairSync('rsa', { modulusLength: 2048 })
    : generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { privateKey, kid, alg: kind === 'rsa' ? 'RS256' : 'ES256', jwk: { ...(publicKey.export({ format: 'jwk' }) as any), kid, use: 'sig', alg: kind === 'rsa' ? 'RS256' : 'ES256' } };
}
function tokenWith(key: { privateKey: KeyObject; kid: string; alg: string } | null, claims: Record<string, unknown>, header: Record<string, unknown> = {}): string {
  const h = b64u(JSON.stringify({ alg: key?.alg ?? 'none', typ: 'JWT', ...(key ? { kid: key.kid } : {}), ...header }));
  const p = b64u(JSON.stringify(claims));
  if (!key) return `${h}.${p}.`;
  const signature = key.alg === 'RS256'
    ? nodeSign('sha256', Buffer.from(`${h}.${p}`), key.privateKey)
    : nodeSign('sha256', Buffer.from(`${h}.${p}`), { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${h}.${p}.${b64u(signature)}`;
}

/** A provider whose published keys can change. */
function idp(keys: { jwk: any }[]) {
  const published = { keys: keys.map((k) => k.jwk) };
  let jwksFetches = 0;
  const provider: OidcProvider = { issuer: ISSUER, authorization_endpoint: `${ISSUER}/authorize`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks` };
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url === provider.jwks_uri) { jwksFetches++; return Response.json(published); }
    return new Response('nope', { status: 404 });
  }) as typeof fetch;
  return { provider, fetch: fetchImpl, published, fetches: () => jwksFetches };
}

const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const good = (extra: Record<string, unknown> = {}) => ({ iss: ISSUER, sub: 'user-123', aud: CLIENT, exp: NOW / 1000 + 300, iat: NOW / 1000 - 5, nonce: 'n-1', email: 'sara@bigco.sa', email_verified: true, ...extra });

test('an ID token signed by the provider’s key, for us, for this sign-in, is accepted — RS256 and ES256', async () => {
  clearOidcCaches();
  const rsa = keyPair('rsa', 'k-rsa');
  const ec = keyPair('ec', 'k-ec');
  const { provider, fetch } = idp([rsa, ec]);
  for (const key of [rsa, ec]) {
    const claims = await verifyIdToken(tokenWith(key, good()), { provider, clientId: CLIENT, nonce: 'n-1' }, { fetch }, NOW);
    assert.deepEqual([claims.sub, claims.email, claims.email_verified], ['user-123', 'sara@bigco.sa', true], key.alg);
  }
  // Several audiences are fine when we are the authorised party.
  await verifyIdToken(tokenWith(rsa, good({ aud: [CLIENT, 'other'], azp: CLIENT })), { provider, clientId: CLIENT, nonce: 'n-1' }, { fetch }, NOW);
  // Within the two-minute allowance for clocks.
  await verifyIdToken(tokenWith(rsa, good({ exp: NOW / 1000 - 60 })), { provider, clientId: CLIENT, nonce: 'n-1' }, { fetch }, NOW);
});

test('every wrong token is refused', async () => {
  clearOidcCaches();
  const rsa = keyPair('rsa', 'k1');
  const stranger = keyPair('rsa', 'k1'); // same kid, another key: a forger's
  const { provider, fetch } = idp([rsa]);
  const refuse = async (token: string, why: RegExp, what: string) =>
    assert.rejects(() => verifyIdToken(token, { provider, clientId: CLIENT, nonce: 'n-1' }, { fetch }, NOW), (e: any) => e instanceof OidcError && why.test(e.message), what);

  await refuse(tokenWith(stranger, good()), /bad signature/, 'signed by another key');
  await refuse(tokenWith(null, good()), /not accepted/, 'alg none');
  const h = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const p = b64u(JSON.stringify(good()));
  await refuse(`${h}.${p}.${b64u(createHmac('sha256', 'the-client-secret').update(`${h}.${p}`).digest())}`, /not accepted/, 'HMAC with the client secret');
  await refuse(tokenWith(rsa, good({ iss: 'https://evil.example.com' })), /another issuer/, 'another issuer');
  await refuse(tokenWith(rsa, good({ aud: 'someone-else' })), /not for this client/, 'another audience');
  await refuse(tokenWith(rsa, good({ aud: [CLIENT, 'other'] })), /another party/, 'several audiences, no azp');
  await refuse(tokenWith(rsa, good({ aud: [CLIENT, 'other'], azp: 'other' })), /another party/, 'issued to the other party');
  await refuse(tokenWith(rsa, good({ exp: NOW / 1000 - 600 })), /expired/, 'expired');
  await refuse(tokenWith(rsa, good({ iat: NOW / 1000 + 600 })), /future/, 'from the future');
  await refuse(tokenWith(rsa, good({ nonce: 'n-2' })), /another sign-in/, 'another sign-in’s nonce');
  await refuse(tokenWith(rsa, good({ nonce: undefined })), /another sign-in/, 'no nonce');
  await refuse(tokenWith(rsa, good({ sub: '' })), /no subject/, 'no subject');
  await refuse('a.b', /malformed/, 'not a JWT');
  const tampered = tokenWith(rsa, good()).split('.');
  await refuse(`${tampered[0]}.${b64u(JSON.stringify(good({ sub: 'admin' })))}.${tampered[2]}`, /bad signature/, 'claims changed after signing');
});

test('a rotated key is fetched once; an unknown one is refused; two candidates are not guessed between', async () => {
  clearOidcCaches();
  const old = keyPair('ec', 'old');
  const next = keyPair('ec', 'new');
  const world = idp([old]);
  const input = { provider: world.provider, clientId: CLIENT, nonce: 'n-1' };
  await verifyIdToken(tokenWith(old, good()), input, { fetch: world.fetch }, NOW);
  world.published.keys.push(next.jwk); // the provider adds its new key
  await verifyIdToken(tokenWith(next, good()), input, { fetch: world.fetch }, NOW);
  assert.equal(world.fetches(), 2, 'fetched again for the unknown kid, not on every token');
  await assert.rejects(() => verifyIdToken(tokenWith(keyPair('ec', 'ghost'), good()), input, { fetch: world.fetch }, NOW), /no published key/);

  clearOidcCaches();
  const a = keyPair('rsa', 'a');
  const b = keyPair('rsa', 'b');
  const twins = idp([{ jwk: { ...a.jwk, kid: undefined } }, { jwk: { ...b.jwk, kid: undefined } }]);
  await assert.rejects(() => verifyIdToken(tokenWith({ ...a }, good(), { kid: undefined }), { ...input, provider: twins.provider }, { fetch: twins.fetch }, NOW), /ambiguous/);
});

test('discovery must name the issuer asked for, with https endpoints', async () => {
  clearOidcCaches();
  const doc = (over: Record<string, unknown> = {}) => (async () => Response.json({
    issuer: ISSUER, authorization_endpoint: `${ISSUER}/auth`, token_endpoint: `${ISSUER}/token`, jwks_uri: `${ISSUER}/jwks`, ...over,
  })) as unknown as typeof fetch;
  assert.equal((await discover(ISSUER, { fetch: doc() }, NOW)).token_endpoint, `${ISSUER}/token`);
  clearOidcCaches();
  await assert.rejects(() => discover(ISSUER, { fetch: doc({ issuer: 'https://evil.example.com' }) }, NOW), /another issuer/);
  clearOidcCaches();
  await assert.rejects(() => discover(ISSUER, { fetch: doc({ token_endpoint: 'http://idp.example.com/token' }) }, NOW), /https/);

  assert.equal(normaliseIssuer('https://login.bigco.sa/realms/staff/'), 'https://login.bigco.sa/realms/staff');
  assert.throws(() => normaliseIssuer('http://login.bigco.sa'), /https/);
  assert.throws(() => normaliseIssuer('https://login.bigco.sa/?x=1'), /query/);
  assert.throws(() => normaliseIssuer('http://localhost:9000'), /https/, 'not even locally, unless a caller says so');
  assert.equal(normaliseIssuer('http://localhost:9000', { allowLocalHttp: true }), 'http://localhost:9000');
  assert.throws(() => normaliseIssuer('http://idp.evil.com', { allowLocalHttp: true }), /https/);
});

test('PKCE, the sign-in link, and the code exchange', async () => {
  const s = await signInSecrets();
  assert.equal(s.challenge, createHash('sha256').update(s.verifier).digest('base64url'));
  assert.ok(s.state.length >= 32 && s.nonce.length >= 32 && s.verifier.length >= 43);
  const { provider } = idp([]);
  const url = new URL(authorizeUrl(provider, { clientId: CLIENT, redirectUri: 'https://app.tajribah.sa/login/sso', state: s.state, nonce: s.nonce, challenge: s.challenge }));
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    response_type: 'code', client_id: CLIENT, redirect_uri: 'https://app.tajribah.sa/login/sso', scope: 'openid email profile',
    state: s.state, nonce: s.nonce, code_challenge: s.challenge, code_challenge_method: 'S256',
  });

  let seen: { auth: string | null; body: string } | null = null;
  const token = (async (_input: unknown, init?: RequestInit) => {
    seen = { auth: new Headers(init?.headers).get('authorization'), body: String(init?.body) };
    return Response.json({ id_token: 'x.y.z', access_token: 'a' });
  }) as typeof fetch;
  assert.equal(await exchangeCode(provider, { code: 'c1', verifier: s.verifier, redirectUri: 'https://app.tajribah.sa/login/sso', clientId: CLIENT, clientSecret: 's3cr&t' }, { fetch: token }), 'x.y.z');
  assert.equal(seen!.auth, `Basic ${Buffer.from(`${CLIENT}:s3cr%26t`).toString('base64')}`);
  assert.deepEqual(Object.fromEntries(new URLSearchParams(seen!.body)), { grant_type: 'authorization_code', code: 'c1', redirect_uri: 'https://app.tajribah.sa/login/sso', code_verifier: s.verifier });
  const refusing = (async () => Response.json({ error: 'invalid_grant' }, { status: 400 })) as unknown as typeof fetch;
  await assert.rejects(() => exchangeCode(provider, { code: 'used', verifier: 'v', redirectUri: 'r', clientId: CLIENT, clientSecret: 's' }, { fetch: refusing }), /invalid_grant/);
});
