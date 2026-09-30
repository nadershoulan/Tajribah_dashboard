/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P8 — single sign-on, against a stand-in provider with real keys (`server/testing/oidc-provider.ts`):
 * the store's settings (Enterprise, owners and admins, the secret sealed and never shown or audited,
 * a provider that must answer before it is switched on); signing in (from the store's address, with
 * this browser's flow, the code once, only members, verified addresses in the store's domains); and
 * the lock — an SSO session acts for its store and nothing else, however it asks.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, plans, sessions, ssoConnections, ssoIdentities, subscriptions, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { clearOidcCaches } from '@/server/core/auth/oidc';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { FakeIdp, IDP_CLIENT, IDP_ISSUER } from '@/server/testing/oidc-provider';
import { FLOW_TTL_MS, completeSsoSignIn, saveSsoSettings, ssoSettings, startSsoSignIn } from '@/server/modules/sso/service';
import { addStoreHandler, meHandler, switchTenantHandler, twoFactorSetupHandler } from '@/server/modules/auth/http';
import { acceptInvitationHandler } from '@/server/modules/team/http';
import { analyticsHandler } from '@/server/modules/analytics/http';
import { staffTrailHandler } from '@/server/modules/admin/http';

setLogLevel('error');
const APP = 'https://app.tajribah.sa';
const SECRET = 'a'.repeat(40);
const KEY = 'k'.repeat(40);
resetEnv();
loadEnv({ APP_URL: APP, AUTH_SECRET: SECRET, ENCRYPTION_KEY: KEY });
const CONFIG = { appUrl: APP, authSecret: SECRET, accessTtlMinutes: 15, refreshTtlDays: 30, keys: { current: KEY } };

async function enterprise(harness: TestDb, idp: FakeIdp, options: { domains?: string[] } = {}) {
  const owner = await seedTenant(harness, 'bigco', { plan: 'enterprise' });
  const ctx = await buildTenantContext({ actor: { userId: owner.userId, email: owner.email, isStaff: false }, tenantId: owner.tenantId, requestId: 'r' });
  await saveSsoSettings(ctx, { issuer: IDP_ISSUER, clientId: IDP_CLIENT.id, clientSecret: IDP_CLIENT.secret, emailDomains: options.domains ?? [], enabled: true }, CONFIG, { fetch: idp.fetch });
  return { ...owner, ctx };
}
async function member(harness: TestDb, tenantId: string, email: string, role = 'editor') {
  const id = uuidv7();
  await harness.asAdmin(async () => {
    await harness.db.insert(users).values({ id, email, passwordHash: 'pbkdf2$sha256$1$x$x', fullName: email.split('@')[0] } as any);
    await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId, userId: id, role, status: 'active' } as any);
  });
  return id;
}
/** A whole sign-in: the store's page, the provider, back with the code. */
async function signIn(idp: FakeIdp, person: { sub: string; email?: string; email_verified?: boolean }, overrides: Record<string, unknown> = {}, store = 'bigco') {
  const { authorizeUrl, flow } = await startSsoSignIn(store, CONFIG, { fetch: idp.fetch });
  const back = idp.signIn(authorizeUrl, { email_verified: true, ...person }, overrides);
  return { back, flow, finish: (patch: Partial<{ code: string; state: string; flowCookie: string | null }> = {}, now = Date.now()) =>
    completeSsoSignIn({ code: back.code, state: back.state, flowCookie: flow, ...patch }, CONFIG, { fetch: idp.fetch }, now) };
}
const call = (handler: (r: Request) => Promise<Response>, token: string, path: string, body?: unknown) =>
  handler(new Request(`${APP}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) }));

test('the settings: Enterprise, owners and admins, the secret sealed and never shown, a provider that answers', async () => {
  clearOidcCaches();
  const harness = await createTestDb();
  try {
    const idp = new FakeIdp();
    const growth = await seedTenant(harness, 'small', { plan: 'growth' });
    const gctx = await buildTenantContext({ actor: { userId: growth.userId, email: growth.email, isStaff: false }, tenantId: growth.tenantId, requestId: 'r' });
    const input = { issuer: IDP_ISSUER, clientId: IDP_CLIENT.id, clientSecret: IDP_CLIENT.secret, emailDomains: [], enabled: true };
    await assert.rejects(() => saveSsoSettings(gctx, input, CONFIG, { fetch: idp.fetch }), (e: any) => e.code === 'plan_required');

    const owner = await seedTenant(harness, 'bigco', { plan: 'enterprise' });
    const ctx = await buildTenantContext({ actor: { userId: owner.userId, email: owner.email, isStaff: false }, tenantId: owner.tenantId, requestId: 'r' });
    const bad = async (patch: Record<string, unknown>, field: string) =>
      assert.rejects(() => saveSsoSettings(ctx, { ...input, ...patch } as any, CONFIG, { fetch: idp.fetch }), (e: any) => e.code === 'validation_failed' && field in (e.errors ?? {}), field);
    await bad({ issuer: 'http://login.bigco.sa' }, 'issuer');
    await bad({ clientSecret: null }, 'clientSecret');
    await bad({ emailDomains: ['not a domain'] }, 'emailDomains');
    await bad({ issuer: 'https://login.elsewhere.sa' }, 'issuer'); // switched on: the provider must answer as itself

    const saved = await saveSsoSettings(ctx, { ...input, emailDomains: ['@BigCo.sa', 'bigco.sa'] }, CONFIG, { fetch: idp.fetch });
    assert.deepEqual([saved.enabled, saved.issuer, saved.clientId, saved.emailDomains], [true, IDP_ISSUER, IDP_CLIENT.id, ['bigco.sa']]);
    assert.equal(saved.redirectUri, `${APP}/login/sso`);
    assert.equal(saved.signInUrl, `${APP}/login/sso?store=bigco`);
    assert.ok(!JSON.stringify(saved).includes(IDP_CLIENT.secret), 'never shown');
    const [row] = await harness.asAdmin(() => harness.db.select().from(ssoConnections)) as any[];
    assert.ok(!row.clientSecretEncrypted.includes(IDP_CLIENT.secret), 'sealed');
    const audit = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceType, 'sso_connection')));
    assert.ok(audit.length >= 1 && !JSON.stringify(audit).includes(row.clientSecretEncrypted), 'not even the sealed secret in the audit log');

    // Saving again without a secret keeps it; an editor may not touch it.
    await saveSsoSettings(ctx, { ...input, clientSecret: null, emailDomains: ['bigco.sa'] }, CONFIG, { fetch: idp.fetch });
    const [kept] = await harness.asAdmin(() => harness.db.select().from(ssoConnections)) as any[];
    assert.equal(kept.clientSecretEncrypted, row.clientSecretEncrypted);
    const editorId = await member(harness, owner.tenantId, 'ed@bigco.sa');
    const editor = await buildTenantContext({ actor: { userId: editorId, email: 'ed@bigco.sa', isStaff: false }, tenantId: owner.tenantId, requestId: 'r' });
    await assert.rejects(() => saveSsoSettings(editor, input, CONFIG, { fetch: idp.fetch }), (e: any) => e.code === 'forbidden');
    assert.equal((await ssoSettings(editor, APP)).enabled, true, 'but may see that it is on');
  } finally { await harness.close(); }
});

test('signing in: a member, once linked, is known by the provider’s id; nobody else gets in', async () => {
  clearOidcCaches();
  const harness = await createTestDb();
  try {
    const idp = new FakeIdp();
    const { tenantId } = await enterprise(harness, idp);
    const sara = await member(harness, tenantId, 'sara@bigco.sa');

    const first = await signIn(idp, { sub: 'idp-sara', email: 'Sara@BigCo.sa' });
    const issued = await first.finish();
    assert.deepEqual([issued.session.userId, issued.session.tenantId, issued.session.ssoTenantId], [sara, tenantId, tenantId]);
    const [link] = await harness.asAdmin(() => harness.db.select().from(ssoIdentities)) as any[];
    assert.deepEqual([link.userId, link.issuer, link.subject], [sara, IDP_ISSUER, 'idp-sara']);

    // The same code again: the provider refuses it, and so do we.
    await assert.rejects(() => first.finish(), (e: any) => e.code === 'forbidden');
    // Linked: known by subject even when the provider now says another address.
    assert.equal((await (await signIn(idp, { sub: 'idp-sara', email: 'sara.a@bigco.sa' })).finish()).session.userId, sara);

    // Not a member of this store (though the provider vouches for them): refused, nothing linked.
    await member(harness, (await seedTenant(harness, 'elsewhere')).tenantId, 'omar@bigco.sa');
    await assert.rejects(async () => (await signIn(idp, { sub: 'idp-omar', email: 'omar@bigco.sa' })).finish(), (e: any) => e.code === 'forbidden' && /not a member/.test(e.message));
    // An address the provider has not verified; a member who has left.
    await assert.rejects(async () => (await signIn(idp, { sub: 'idp-x', email: 'sara@bigco.sa', email_verified: false })).finish(), (e: any) => e.code === 'forbidden');
    const leaver = await member(harness, tenantId, 'leaver@bigco.sa'); // suspended by the store
    await harness.asAdmin(() => harness.db.update(tenantMemberships).set({ status: 'suspended' } as any).where(eq(tenantMemberships.userId, leaver)));
    await assert.rejects(async () => (await signIn(idp, { sub: 'idp-leaver', email: 'leaver@bigco.sa' })).finish(), (e: any) => e.code === 'forbidden');
    assert.equal((await harness.asAdmin(() => harness.db.select().from(ssoIdentities))).length, 1, 'only Sara was ever linked');
  } finally { await harness.close(); }
});

test('only this browser’s sign-in, fresh, for this nonce, in the store’s domains, at an Enterprise store', async () => {
  clearOidcCaches();
  const harness = await createTestDb();
  try {
    const idp = new FakeIdp();
    const { tenantId } = await enterprise(harness, idp, { domains: ['bigco.sa'] });
    await member(harness, tenantId, 'sara@bigco.sa');
    await member(harness, tenantId, 'contractor@gmail.com');
    const forbidden = (e: any) => e.code === 'forbidden';

    const a = await signIn(idp, { sub: 's', email: 'sara@bigco.sa' });
    const b = await signIn(idp, { sub: 's', email: 'sara@bigco.sa' });
    await assert.rejects(() => a.finish({ flowCookie: null }), forbidden, 'no flow cookie: not this browser');
    await assert.rejects(() => a.finish({ flowCookie: b.flow }), forbidden, 'another sign-in’s cookie');
    await assert.rejects(() => a.finish({ flowCookie: `${a.flow.split('.')[0]}.forged` }), forbidden, 'a cookie we did not sign');
    await assert.rejects(() => a.finish({}, Date.now() + FLOW_TTL_MS + 1000), forbidden, 'too late');
    await assert.rejects(() => a.finish({ state: 'not-the-state-we-sent' }), forbidden, 'the right browser, but not the state it was given');
    await assert.rejects(async () => (await signIn(idp, { sub: 's', email: 'sara@bigco.sa' }, { nonce: 'replayed' })).finish(), forbidden, 'an ID token for another sign-in');
    await assert.rejects(async () => (await signIn(idp, { sub: 'c', email: 'contractor@gmail.com' })).finish(), (e: any) => forbidden(e) && /domains/.test(e.message), 'outside the store’s domains');
    await a.finish(); // the right cookie, in time: in

    await assert.rejects(() => startSsoSignIn('no-such-store', CONFIG, { fetch: idp.fetch }), (e: any) => e.status === 404);
    // A store that leaves Enterprise: its single sign-on stops with it.
    const [growth] = await harness.asAdmin(() => harness.db.select({ id: plans.id }).from(plans).where(eq(plans.code, 'growth')));
    await harness.asAdmin(() => harness.db.update(subscriptions).set({ planId: growth!.id } as any).where(eq(subscriptions.tenantId, tenantId)));
    await assert.rejects(() => startSsoSignIn('bigco', CONFIG, { fetch: idp.fetch }), (e: any) => e.status === 404, 'not Enterprise any more');
    const [top] = await harness.asAdmin(() => harness.db.select({ id: plans.id }).from(plans).where(eq(plans.code, 'enterprise')));
    await harness.asAdmin(() => harness.db.update(subscriptions).set({ planId: top!.id } as any).where(eq(subscriptions.tenantId, tenantId)));
    const pending = await signIn(idp, { sub: 's', email: 'sara@bigco.sa' });
    await harness.asAdmin(() => harness.db.update(ssoConnections).set({ enabled: false } as any));
    await assert.rejects(() => pending.finish(), (e: any) => e.status === 404, 'switched off while someone was at the provider');
  } finally { await harness.close(); }
});

test('an SSO session acts for its store and nothing else', async () => {
  clearOidcCaches();
  const harness = await createTestDb();
  try {
    const idp = new FakeIdp();
    const { tenantId } = await enterprise(harness, idp);
    const sara = await member(harness, tenantId, 'sara@bigco.sa', 'admin');
    // Sara also owns a store of her own, and is on the staff.
    const hers = await seedTenant(harness, 'saras-shop');
    await harness.asAdmin(async () => {
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: hers.tenantId, userId: sara, role: 'owner', status: 'active' } as any);
      await harness.db.update(users).set({ isStaff: true, totpEnabled: true } as any).where(eq(users.id, sara));
    });
    const { accessToken, session } = await (await signIn(idp, { sub: 'idp-sara', email: 'sara@bigco.sa' })).finish();

    const me = await (await call(meHandler, accessToken, '/api/auth/me')).json() as any;
    assert.deepEqual([me.tenants.map((t: any) => t.id), me.ssoStoreId], [[tenantId], tenantId], 'her own shop is not even listed');
    assert.equal((await call(analyticsHandler, accessToken, '/api/analytics?range=7d')).status, 200, 'the store itself: yes');

    for (const [name, response] of [
      ['switch to her shop', await call(switchTenantHandler, accessToken, '/api/auth/switch-tenant', { tenantId: hers.tenantId })],
      ['add a store', await call(addStoreHandler, accessToken, '/api/auth/stores', { storeName: 'Another' })],
      ['two-step sign-in', await call(twoFactorSetupHandler, accessToken, '/api/auth/2fa/setup', { password: 'whatever-it-is' })],
      ['accept an invitation', await call(acceptInvitationHandler, accessToken, '/api/invitations/accept', { token: 'x'.repeat(20) })],
      ['the staff console', await call(staffTrailHandler, accessToken, '/api/admin/audit')],
    ] as const) assert.equal(response.status, 403, name);

    // Even were the session pointed at her shop some other way, no request would act for it.
    await harness.asAdmin(() => harness.db.update(sessions).set({ tenantId: hers.tenantId } as any).where(eq(sessions.id, session.id)));
    assert.equal((await call(analyticsHandler, accessToken, '/api/analytics?range=7d')).status, 403);
  } finally { await harness.close(); }
});
