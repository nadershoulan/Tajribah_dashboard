/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P8 — single sign-on against a real OpenID Connect provider (docs/SSO-LIVE.md): skipped unless
 * SSO_LIVE_ISSUER is set. A member signs in at the provider's own pages (driven here over HTTP, as a
 * browser would), comes back with a real code, and gets a session locked to the store; someone the
 * provider vouches for who is not a member does not.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ssoIdentities, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import { completeSsoSignIn, saveSsoSettings, startSsoSignIn } from '@/server/modules/sso/service';

const ISSUER = process.env.SSO_LIVE_ISSUER;
const APP = 'https://app.tajribah.sa';
const CONFIG = { appUrl: APP, authSecret: 'a'.repeat(40), accessTtlMinutes: 15, refreshTtlDays: 30, keys: { current: 'k'.repeat(40) } };
const LOCAL = { allowLocalHttp: true };
setLogLevel('error');

/** A browser at the provider: follows its redirects with its cookies, signs in as `email`, consents. */
async function atProvider(authorizeUrl: string, email: string): Promise<{ code: string; state: string }> {
  const jar = new Map<string, string>();
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
  const keep = (response: Response) => {
    for (const line of response.headers.getSetCookie()) { const [pair] = line.split(';'); const [k, ...v] = pair!.split('='); jar.set(k!.trim(), v.join('=')); }
  };
  let url = authorizeUrl;
  let body: URLSearchParams | null = null;
  for (let step = 0; step < 20; step++) {
    const response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'manual', headers: { cookie: cookie(), ...(body ? { 'content-type': 'application/x-www-form-urlencoded' } : {}) }, body: body?.toString() });
    keep(response);
    body = null;
    const location = response.headers.get('location');
    if (location) {
      const next = new URL(location, url);
      if (next.toString().startsWith(`${APP}/login/sso`)) {
        const error = next.searchParams.get('error');
        if (error) throw new Error(`the provider said ${error}: ${next.searchParams.get('error_description')}`);
        return { code: next.searchParams.get('code')!, state: next.searchParams.get('state')! };
      }
      url = next.toString();
      continue;
    }
    // A sign-in or consent page: submit its form, as a person would.
    const html = await response.text();
    const action = /<form[^>]*action="([^"]+)"/.exec(html)?.[1];
    if (!action) throw new Error(`no form on ${url}: ${html.slice(0, 200)}`);
    body = new URLSearchParams();
    for (const m of html.matchAll(/<input[^>]*type="hidden"[^>]*name="([^"]+)"[^>]*value="([^"]*)"/g)) body.set(m[1]!, m[2]!);
    if (/name="login"/.test(html)) { body.set('login', email); body.set('password', 'anything'); }
    url = new URL(action.replace(/&amp;/g, '&'), url).toString();
  }
  throw new Error('the provider never sent the browser back');
}

test('a member signs in at a real provider and gets a session for this store only; a stranger does not', { skip: !ISSUER && 'set SSO_LIVE_ISSUER (docs/SSO-LIVE.md)' }, async () => {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: CONFIG.authSecret, ENCRYPTION_KEY: CONFIG.keys.current });
  const harness = await createTestDb();
  try {
    const owner = await seedTenant(harness, 'bigco', { plan: 'enterprise' });
    const ctx = await buildTenantContext({ actor: { userId: owner.userId, email: owner.email, isStaff: false }, tenantId: owner.tenantId, requestId: 'live' });
    await saveSsoSettings(ctx, { issuer: ISSUER!, clientId: 'tajribah', clientSecret: 'idp-client-secret', emailDomains: ['bigco.sa'], enabled: true }, CONFIG, LOCAL);
    const sara = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: sara, email: 'sara@bigco.sa', passwordHash: 'x', fullName: 'Sara' } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: owner.tenantId, userId: sara, role: 'editor', status: 'active' } as any);
    });

    const { authorizeUrl, flow } = await startSsoSignIn('bigco', CONFIG, LOCAL);
    const back = await atProvider(authorizeUrl, 'sara@bigco.sa');
    const issued = await completeSsoSignIn({ ...back, flowCookie: flow }, CONFIG, LOCAL);
    assert.deepEqual([issued.session.userId, issued.session.tenantId, issued.session.ssoTenantId], [sara, owner.tenantId, owner.tenantId]);
    const [link] = await harness.asAdmin(() => harness.db.select().from(ssoIdentities)) as any[];
    assert.equal(link.issuer, ISSUER);
    assert.equal(link.subject, 'sara@bigco.sa', 'linked by the subject the provider sent (this one uses the login)');
    await assert.rejects(() => completeSsoSignIn({ ...back, flowCookie: flow }, CONFIG, LOCAL), (e: any) => e.code === 'forbidden', 'the real code works once');

    const stranger = await startSsoSignIn('bigco', CONFIG, LOCAL);
    const theirs = await atProvider(stranger.authorizeUrl, 'omar@bigco.sa');
    await assert.rejects(() => completeSsoSignIn({ ...theirs, flowCookie: stranger.flow }, CONFIG, LOCAL), (e: any) => e.code === 'forbidden' && /not a member/.test(e.message));
  } finally { await harness.close(); resetEnv(); }
});
