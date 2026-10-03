/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T69 — GA4 measurement ids set from the dashboard. Google's side is a stand-in server that answers
 * as Google's OAuth and Analytics Admin API documentation say (token exchange, account summaries with
 * pages, each property's data streams), and refuses anything else.
 *
 *  - Signing in with Google lists the person's GA4 web streams and keeps nothing of Google's: the
 *    ticket carries ids and names, never the token, and opens only for whoever started it.
 *  - The state is bound to the browser and expires; a refusal on Google's screen, an unticked
 *    permission, wrong app keys, no web streams and Google being down each come back as a reason.
 *  - Staff set the website's id: it reaches the config store, where the website reads it, with a
 *    reason in the staff trail. A store's own id is a store setting, and its live configs refresh.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { jobs, siteSettings, staffAudit } from '@/db/schema';
import { Transport, type Clock } from '@/server/connectors/transport';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { MemoryConfigStore, setConfigStore } from '@/server/core/edge/configs';
import { serveConfig } from '@/server/core/edge/host';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import type { StaffContext } from '@/server/modules/admin/access';
import { SITE_SETTINGS_KEY, siteSettingsForStaff, updateSiteSettings } from '@/server/modules/admin/site';
import { getSettings, updateSettings } from '@/server/modules/settings/service';
import { GA4_SCOPE, STATE_TTL_MS, TICKET_TTL_MS, completeGoogleCallback, openTicket, startGoogle, type GoogleApp } from '@/server/modules/google/ga4';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'https://app.tajribah.sa', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });

const APP: GoogleApp = { clientId: '1234-abc.apps.googleusercontent.com', clientSecret: 'g-secret', redirectUri: 'https://app.tajribah.sa/api/google/callback', authSecret: 's'.repeat(40) };
const STAFF = { p: 'site', u: '00000000-0000-7000-8000-000000000001' } as const;
const instant: Clock = { now: () => Date.now(), sleep: async () => {}, random: () => 0 };

/** Google, as its documentation describes it: one code, one token, read-only Analytics. */
class Google {
  codes = new Set<string>();
  token = 'ya29.stand-in-token';
  grantedScope = GA4_SCOPE;
  tokenError: string | null = null;
  down = false;
  /** Two accounts; the first's properties come over two pages. */
  accounts = [
    { account: 'accounts/1', displayName: 'Tajribah', propertySummaries: [{ property: 'properties/11', displayName: 'tajribah.sa' }] },
    { account: 'accounts/1', displayName: 'Tajribah', propertySummaries: [{ property: 'properties/12', displayName: 'Apps only' }] },
    { account: 'accounts/2', displayName: 'Oud store', propertySummaries: [{ property: 'properties/21', displayName: 'oud.sa' }] },
  ];
  streams: Record<string, any[]> = {
    'properties/11': [{ type: 'WEB_DATA_STREAM', displayName: 'Website', webStreamData: { measurementId: 'G-TAJ1234567', defaultUri: 'https://tajribah.sa' } }],
    'properties/12': [{ type: 'ANDROID_APP_DATA_STREAM', displayName: 'Android', androidAppStreamData: { packageName: 'sa.tajribah' } }],
    'properties/21': [
      { type: 'WEB_DATA_STREAM', displayName: 'Shop', webStreamData: { measurementId: 'G-OUD7654321', defaultUri: 'https://oud.sa' } },
      { type: 'WEB_DATA_STREAM', displayName: 'Broken', webStreamData: { measurementId: 'UA-1234-1' } },
    ],
  };
  seen: string[] = [];

  approve(): string { const code = `4/code-${this.codes.size + 1}`; this.codes.add(code); return code; }

  fetch = async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    this.seen.push(`${init.method ?? 'GET'} ${url.origin}${url.pathname}`);
    if (this.down) return new Response('busy', { status: 503 });
    if (url.href === 'https://oauth2.googleapis.com/token') {
      const form = new URLSearchParams(String(init.body));
      if (this.tokenError) return Response.json({ error: this.tokenError }, { status: 401 });
      if (form.get('client_id') !== APP.clientId || form.get('client_secret') !== APP.clientSecret) return Response.json({ error: 'invalid_client' }, { status: 401 });
      if (form.get('redirect_uri') !== APP.redirectUri || form.get('grant_type') !== 'authorization_code' || !this.codes.delete(form.get('code') ?? '')) return Response.json({ error: 'invalid_grant' }, { status: 400 });
      return Response.json({ access_token: this.token, expires_in: 3599, scope: this.grantedScope, token_type: 'Bearer' });
    }
    if (new Headers(init.headers).get('authorization') !== `Bearer ${this.token}`) return Response.json({ error: { code: 401 } }, { status: 401 });
    if (url.pathname === '/v1beta/accountSummaries') {
      const page = Number(url.searchParams.get('pageToken') ?? '0');
      const next = page + 2 < this.accounts.length ? String(page + 2) : undefined;
      return Response.json({ accountSummaries: this.accounts.slice(page, page + 2), ...(next ? { nextPageToken: next } : {}) });
    }
    const property = /^\/v1beta\/(properties\/\d+)\/dataStreams$/.exec(url.pathname)?.[1];
    if (property && this.streams[property]) return Response.json({ dataStreams: this.streams[property] });
    return Response.json({ error: { code: 404 } }, { status: 404 });
  };

  transport() { return new Transport('google', { rate: { requests: 100_000, perMs: 1000 }, maxAttempts: 1 }, this.fetch, instant); }
}

const stateOf = (authorizeUrl: string) => new URL(authorizeUrl).searchParams.get('state')!;
const fragment = (location: string) => new URLSearchParams(location.split('#')[1] ?? '');

test('signing in with Google lists the GA4 web streams; the ticket holds no token and opens only for who started it', async () => {
  const google = new Google();
  const { authorizeUrl, nonce } = await startGoogle(APP, STAFF);
  const url = new URL(authorizeUrl);
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.deepEqual(['client_id', 'redirect_uri', 'response_type', 'scope', 'access_type'].map((k) => url.searchParams.get(k)),
    [APP.clientId, APP.redirectUri, 'code', 'https://www.googleapis.com/auth/analytics.readonly', 'online'], 'read-only, no refresh token');

  const location = await completeGoogleCallback(new URLSearchParams({ code: google.approve(), state: stateOf(authorizeUrl) }), nonce, APP, { transport: google.transport() });
  assert.match(location, /^\/admin\/site#ga4=/, 'back to the screen that started it, in the fragment');
  const ticket = fragment(location).get('ga4')!;
  assert.ok(!location.includes(google.token) && !atob(ticket.split('.')[0]!.replace(/-/g, '+').replace(/_/g, '/')).includes('ya29'), 'Google’s token is not kept');

  const streams = await openTicket(APP, ticket, STAFF);
  assert.deepEqual(streams, [
    { measurementId: 'G-TAJ1234567', stream: 'Website', property: 'tajribah.sa', account: 'Tajribah', url: 'https://tajribah.sa' },
    { measurementId: 'G-OUD7654321', stream: 'Shop', property: 'oud.sa', account: 'Oud store', url: 'https://oud.sa' },
  ], 'web streams only, from every page of accounts; an app stream and a non-GA4 id are left out');

  await assert.rejects(() => openTicket(APP, ticket, { p: 'site', u: '00000000-0000-7000-8000-000000000002' }), /not yours/, 'another staff member');
  await assert.rejects(() => openTicket(APP, ticket, { p: 'store', t: 't', u: STAFF.u }), /not yours/, 'the same person, as a store');
  await assert.rejects(() => openTicket(APP, ticket, STAFF, Date.now() + TICKET_TTL_MS + 1000), /expired/);
  const [payload, mac] = ticket.split('.');
  await assert.rejects(() => openTicket(APP, `${payload}x.${mac}`, STAFF), /expired|not yours/, 'a changed ticket');

  // A store's sign-in returns to Store settings and opens only for that person in that store.
  const store = { p: 'store', t: '00000000-0000-7000-8000-0000000000aa', u: STAFF.u } as const;
  const started = await startGoogle(APP, store);
  const back = await completeGoogleCallback(new URLSearchParams({ code: google.approve(), state: stateOf(started.authorizeUrl) }), started.nonce, APP, { transport: google.transport() });
  assert.match(back, /^\/dashboard\/settings#ga4=/);
  assert.equal((await openTicket(APP, fragment(back).get('ga4')!, store)).length, 2);
  await assert.rejects(() => openTicket(APP, fragment(back).get('ga4')!, { ...store, t: '00000000-0000-7000-8000-0000000000bb' }), /not yours/, 'another store');
});

test('every way it can go wrong comes back as a reason, on the screen that started it', async () => {
  const google = new Google();
  const run = async (opts: { nonce?: string | null; query?: Record<string, string>; now?: number } = {}) => {
    const { authorizeUrl, nonce } = await startGoogle(APP, STAFF);
    const query = new URLSearchParams({ code: google.approve(), state: stateOf(authorizeUrl), ...(opts.query ?? {}) });
    return completeGoogleCallback(query, opts.nonce === undefined ? nonce : opts.nonce, APP, { transport: google.transport(), now: opts.now });
  };
  const why = async (location: Promise<string>) => fragment(await location).get('ga4_error');

  assert.equal(await why(run({ nonce: null })), 'state', 'no cookie: another browser');
  assert.equal(await why(run({ nonce: 'f'.repeat(32) })), 'state', 'another browser’s cookie');
  assert.equal(await why(run({ now: Date.now() + STATE_TTL_MS + 1000 })), 'state', 'expired');
  assert.equal(await why(run({ query: { state: 'forged.state' } })), 'state', 'forged');
  assert.equal(await why(run({ query: { error: 'access_denied' } })), 'denied', 'cancelled on Google’s screen');

  google.grantedScope = 'openid';
  assert.equal(await why(run()), 'scope', 'the Analytics permission unticked');
  google.grantedScope = GA4_SCOPE;

  google.tokenError = 'invalid_client';
  assert.equal(await why(run()), 'setup', 'our own keys are wrong');
  google.tokenError = null;

  const reused = google.approve();
  const first = await startGoogle(APP, STAFF);
  await completeGoogleCallback(new URLSearchParams({ code: reused, state: stateOf(first.authorizeUrl) }), first.nonce, APP, { transport: google.transport() });
  const second = await startGoogle(APP, STAFF);
  assert.equal(await why(completeGoogleCallback(new URLSearchParams({ code: reused, state: stateOf(second.authorizeUrl) }), second.nonce, APP, { transport: google.transport() })), 'code', 'a code works once');

  const streams = google.streams;
  google.streams = { 'properties/11': [], 'properties/12': streams['properties/12']!, 'properties/21': [] };
  assert.equal(await why(run()), 'none', 'no web streams to pick');
  google.streams = streams;

  google.down = true;
  assert.equal(await why(run()), 'unavailable', 'Google down');
  google.down = false;
  assert.ok((await run()).includes('#ga4='), 'and fine again');
});

const STAFF_CTX = (id: string): StaffContext => ({ userId: id, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'r' });

test('staff set the website’s GA4 id: it reaches the config store the website reads, with a reason in the trail', async () => {
  const harness = await createTestDb();
  const configs = new MemoryConfigStore();
  setConfigStore(configs);
  try {
    const { userId } = await seedTenant(harness, 'alpha');
    const staff = STAFF_CTX(userId);
    assert.deepEqual(await siteSettingsForStaff(), { ga4MeasurementId: null, updatedAt: null }, 'nothing until staff set it');

    await assert.rejects(() => updateSiteSettings(staff, { ga4MeasurementId: 'UA-12345-1', reason: 'the old kind of id' }), (e: any) => e.code === 'validation_failed' && !!e.errors?.ga4MeasurementId);
    await assert.rejects(() => updateSiteSettings(staff, { ga4MeasurementId: 'G-TAJ1234567', reason: 'no' }), (e: any) => e.code === 'validation_failed', 'a reason');
    assert.equal(configs.entries.size, 0, 'a refused save writes nothing');

    const saved = await updateSiteSettings(staff, { ga4MeasurementId: ' g-taj1234567 ', reason: 'the website property is ready' });
    assert.equal(saved.ga4MeasurementId, 'G-TAJ1234567', 'as Google writes it');
    const served = await serveConfig(new Request(`https://cfg.tajribah.com/v1/${SITE_SETTINGS_KEY}`), configs);
    assert.equal(served.status, 200, 'the config host answers the website');
    assert.deepEqual(await served.json(), { v: 1, ga4: 'G-TAJ1234567' });

    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit).where(eq(staffAudit.action, 'site.ga4'))) as any[];
    assert.deepEqual([trail.length, trail[0].reason, trail[0].detail], [1, 'the website property is ready', { before: null, after: 'G-TAJ1234567' }]);

    await updateSiteSettings(staff, { ga4MeasurementId: '', reason: 'analytics switched off for now' });
    assert.deepEqual(JSON.parse((await configs.get(SITE_SETTINGS_KEY))!), { v: 1, ga4: null }, 'cleared: the website stops loading it');
    assert.equal((await harness.asAdmin(() => harness.db.select().from(siteSettings))).length, 0);
    assert.equal((await siteSettingsForStaff()).ga4MeasurementId, null);
  } finally { setConfigStore(new MemoryConfigStore()); await harness.close(); }
});

async function storeCtx(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  return { ...seeded, ctx: await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` }) };
}

test('a store’s own GA4 id is a store setting: checked, saved, and its live configs refreshed', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await storeCtx(harness, 'oud');
    assert.equal((await getSettings(ctx)).ga4MeasurementId, null);
    await assert.rejects(() => updateSettings(ctx, { ga4MeasurementId: 'GTM-ABCD12' }), (e: any) => e.code === 'validation_failed' && !!e.errors?.ga4MeasurementId, 'a Tag Manager id is not a measurement id');
    assert.equal((await updateSettings(ctx, { ga4MeasurementId: 'g-oud7654321' })).ga4MeasurementId, 'G-OUD7654321');
    const queued = await harness.asAdmin(() => harness.db.select().from(jobs).where(eq(jobs.tenantId, tenantId))) as any[];
    assert.ok(queued.some((j) => j.queue === 'edge.publish-config'), 'its products’ pages pick it up');
    assert.equal((await updateSettings(ctx, { ga4MeasurementId: '' })).ga4MeasurementId, null, 'blank clears');
  } finally { await harness.close(); }
});
