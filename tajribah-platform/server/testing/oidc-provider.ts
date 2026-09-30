/**
 * P8 — a stand-in OpenID Connect provider for the single sign-on tests: discovery, published keys
 * (a real ES256 key pair from node:crypto), and a token endpoint that swaps a code — once, with the
 * right client secret and PKCE verifier — for an ID token about whoever `signIn` said. Tests only.
 */
import { createHash, generateKeyPairSync, sign as nodeSign, type KeyObject } from 'node:crypto';

export const IDP_ISSUER = 'https://login.bigco.sa';
export const IDP_CLIENT = { id: 'tajribah', secret: 'idp-client-secret' };

const b64u = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');

type Person = { sub: string; email?: string; email_verified?: boolean; name?: string };
type Pending = { person: Person; nonce: string; challenge: string; redirectUri: string; overrides: Record<string, unknown> };

export class FakeIdp {
  private readonly key: KeyObject;
  readonly jwk: Record<string, unknown>;
  private readonly codes = new Map<string, Pending>();
  down = false;
  tokenRequests = 0;

  constructor(readonly issuer = IDP_ISSUER) {
    const { privateKey, publicKey } = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    this.key = privateKey;
    this.jwk = { ...(publicKey.export({ format: 'jwk' }) as object), kid: 'k1', use: 'sig', alg: 'ES256' };
  }

  /**
   * The person signs in at the provider for the sign-in `authorizeUrl` started; the provider sends the
   * browser back with a code. `overrides` changes what the ID token will say (a forged nonce, say).
   */
  signIn(authorizeUrl: string, person: Person, overrides: Record<string, unknown> = {}): { code: string; state: string } {
    const url = new URL(authorizeUrl);
    if (`${url.origin}${url.pathname}` !== `${this.issuer}/authorize`) throw new Error(`not this provider: ${authorizeUrl}`);
    const code = `code-${this.codes.size + 1}-${Math.random().toString(36).slice(2)}`;
    this.codes.set(code, {
      person, nonce: url.searchParams.get('nonce')!, challenge: url.searchParams.get('code_challenge')!,
      redirectUri: url.searchParams.get('redirect_uri')!, overrides,
    });
    return { code, state: url.searchParams.get('state')! };
  }

  private idToken(claims: Record<string, unknown>): string {
    const h = b64u(JSON.stringify({ alg: 'ES256', kid: 'k1', typ: 'JWT' }));
    const p = b64u(JSON.stringify(claims));
    return `${h}.${p}.${b64u(nodeSign('sha256', Buffer.from(`${h}.${p}`), { key: this.key, dsaEncoding: 'ieee-p1363' }))}`;
  }

  readonly fetch = (async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input instanceof Request ? input.url : input);
    if (this.down) return new Response('down', { status: 503 });
    if (url === `${this.issuer}/.well-known/openid-configuration`) {
      return Response.json({ issuer: this.issuer, authorization_endpoint: `${this.issuer}/authorize`, token_endpoint: `${this.issuer}/token`, jwks_uri: `${this.issuer}/jwks` });
    }
    if (url === `${this.issuer}/jwks`) return Response.json({ keys: [this.jwk] });
    if (url === `${this.issuer}/token` && init?.method === 'POST') {
      this.tokenRequests += 1;
      const auth = new Headers(init.headers).get('authorization') ?? '';
      const [id, secret] = Buffer.from(auth.replace(/^Basic /, ''), 'base64').toString().split(':').map(decodeURIComponent);
      const form = new URLSearchParams(String(init.body));
      const pending = this.codes.get(form.get('code') ?? '');
      const pkce = pending && createHash('sha256').update(form.get('code_verifier') ?? '').digest('base64url') === pending.challenge;
      if (id !== IDP_CLIENT.id || secret !== IDP_CLIENT.secret) return Response.json({ error: 'invalid_client' }, { status: 401 });
      if (!pending || !pkce || form.get('redirect_uri') !== pending.redirectUri) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      this.codes.delete(form.get('code')!);
      const now = Math.floor(Date.now() / 1000);
      const idToken = this.idToken({ iss: this.issuer, aud: IDP_CLIENT.id, iat: now, exp: now + 300, nonce: pending.nonce, ...pending.person, ...pending.overrides });
      return Response.json({ access_token: 'at', token_type: 'Bearer', id_token: idToken });
    }
    return new Response('not found', { status: 404 });
  }) as typeof fetch;
}
