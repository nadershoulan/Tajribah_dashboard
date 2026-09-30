/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T61 — connecting a Zid store as Zid's OAuth policy requires: OAuth starts at once from Zid's
 * "Activate" (or from Store connections), the `state` is one-time and bound to the browser that
 * started it, the code is exchanged at the callback, the store is identified from Zid's own answer,
 * a linked store is renewed rather than duplicated, and linking takes the merchant's own session —
 * the very merchant who started it, when one did. Then the store's product webhooks are subscribed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { storeConnections, storeGrants, syncJobs } from '@/db/schema';
import { Transport, type Clock } from '@/server/connectors/transport';
import { zidCredentials } from '@/server/connectors/zid/connector';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { ZID_APP, ZID_STORE_ID, ZidStore } from '@/server/testing/zid-store';
import { accessTokenFor, vaultKeys } from '@/server/modules/connections/service';
import { openTokens } from '@/server/modules/connections/vault';
import { activateZidHandler, zidCallbackHandler } from '@/server/modules/connections/http';
import { STATE_TTL_MS, ZID_STATE_COOKIE, completeZidCallback, linkZidStore, startZid, startZidFromDashboard, zidWebhookPassword } from '@/server/modules/connections/zid';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'https://app.tajribah.sa', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40), ZID_CLIENT_ID: ZID_APP.clientId, ZID_CLIENT_SECRET: ZID_APP.clientSecret });

const CONFIG = { ...ZID_APP, authSecret: 's'.repeat(40), appUrl: 'https://app.tajribah.sa' };
const instant: Clock = { now: () => Date.now(), sleep: async () => {}, random: () => 0 };
const transportFor = (store: ZidStore) => new Transport('zid', { rate: { requests: 100_000, perMs: 1000 } }, store.fetch, instant);

async function merchant(harness: TestDb, name: string, plan: 'starter' | 'pro' = 'pro') {
  const seeded = await seedTenant(harness, name, { plan });
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `r-${name}` });
  return { ...seeded, ctx };
}
const rows = (harness: TestDb, table: any): Promise<any[]> => harness.asAdmin(() => harness.db.select().from(table) as any);
const stateOf = (authorizeUrl: string) => new URL(authorizeUrl).searchParams.get('state')!;
/** Zid sends the merchant back: the code it issued and the state it was given. */
const callback = (store: ZidStore, state: string, extra: Record<string, string> = {}) =>
  new URLSearchParams({ code: store.approve(), state, ...extra });
const ticketOf = (location: string) => new URL(location, 'https://app.tajribah.sa').searchParams.get('zid');

test('Activate in Zid → OAuth at once → the callback holds the access → the signed-in merchant links it', async () => {
  const harness = await createTestDb();
  try {
    const store = new ZidStore([]);
    const { ctx } = await merchant(harness, 'oud');

    const { authorizeUrl, nonce } = await startZid(CONFIG, null);
    const url = new URL(authorizeUrl);
    assert.equal(url.origin + url.pathname, 'https://oauth.zid.sa/oauth/authorize');
    assert.deepEqual([url.searchParams.get('client_id'), url.searchParams.get('redirect_uri'), url.searchParams.get('response_type')], [ZID_APP.clientId, ZID_APP.redirectUri, 'code']);
    assert.ok(nonce.length >= 32, 'a random nonce for the browser’s cookie');

    const location = await completeZidCallback(callback(store, stateOf(authorizeUrl)), nonce, CONFIG, { transport: transportFor(store) });
    assert.match(location, /^\/dashboard\/connections\?zid=/);
    const [grant] = await rows(harness, storeGrants);
    assert.deepEqual([grant.provider, grant.externalStoreId], ['zid', ZID_STORE_ID]);
    assert.ok(!JSON.stringify(grant).includes('zid_manager_1'), 'sealed, never in the clear');
    assert.equal(zidCredentials((await openTokens(grant, vaultKeys()))!.accessToken).storeId, ZID_STORE_ID, 'the store Zid named');

    const connection = await linkZidStore(ctx, ticketOf(location)!, CONFIG, { transport: transportFor(store) });
    assert.deepEqual([connection.provider, connection.status, connection.storeName, connection.storeUrl], ['zid', 'active', 'متجر العود', 'https://oud.zid.store/']);
    assert.equal(zidCredentials(await accessTokenFor(ctx, connection.id)).manager, 'zid_manager_1');
    assert.equal((await rows(harness, storeGrants)).length, 0);
    assert.deepEqual((await rows(harness, syncJobs)).map((s) => [s.type, s.triggeredBy]), [['full', 'user']]);

    // The store's product webhooks, each with its own credentials — ours for that store and event only.
    assert.deepEqual(store.webhooks.map((w) => w.event), ['product.create', 'product.update', 'product.publish', 'product.delete']);
    for (const w of store.webhooks) {
      assert.equal(w.target_url, 'https://app.tajribah.sa/api/webhooks/zid');
      assert.equal(w.username, `${ZID_STORE_ID}.${w.event}`);
      assert.equal(w.password, await zidWebhookPassword(ZID_APP.clientSecret, w.username));
      assert.equal(w.original_id, ZID_APP.clientId);
    }

    // Activated again (a reinstall): the linked store's tokens are renewed — no second connection, no waiting access.
    const again = await startZid(CONFIG, null);
    assert.equal(await completeZidCallback(callback(store, stateOf(again.authorizeUrl)), again.nonce, CONFIG, { transport: transportFor(store) }), '/dashboard/connections?zid=renewed');
    assert.equal((await rows(harness, storeConnections)).length, 1);
    assert.equal((await rows(harness, storeGrants)).length, 0);
    assert.equal(zidCredentials(await accessTokenFor(ctx, connection.id)).manager, 'zid_manager_2');
  } finally { await harness.close(); }
});

test('the state is one-time, short-lived and bound to the browser that started it — otherwise the code is not even exchanged', async () => {
  const harness = await createTestDb();
  try {
    const store = new ZidStore([]);
    const { authorizeUrl, nonce } = await startZid(CONFIG, null);
    const state = stateOf(authorizeUrl);
    const refused = async (query: URLSearchParams, cookie: string | null, now?: number) => {
      const code = query.get('code')!;
      const location = await completeZidCallback(query, cookie, CONFIG, { transport: transportFor(store), now });
      assert.equal(location, '/dashboard/connections?zid_error=state');
      assert.ok(store.codes.has(code), 'the code was never sent to Zid');
    };
    await refused(callback(store, state), null); // no cookie: another browser
    const other = await startZid(CONFIG, null);
    await refused(callback(store, state), other.nonce); // another browser's cookie
    await refused(callback(store, `${state.split('.')[0]}x.${state.split('.')[1]}`), nonce); // altered
    await refused(callback(store, state), nonce, Date.now() + STATE_TTL_MS + 1); // too late
    await refused(callback(store, 'nonsense'), nonce);
    // A well-formed state with the right nonce but not signed by us (someone else's making).
    const unsigned = `${Buffer.from(JSON.stringify({ n: nonce, e: Date.now() + 60_000 })).toString('base64url')}.${state.split('.')[1]}`;
    await refused(callback(store, unsigned), nonce);
    assert.equal((await rows(harness, storeGrants)).length, 0);

    // The merchant declined on Zid's screen (a valid state): said so, nothing held.
    assert.equal(await completeZidCallback(new URLSearchParams({ error: 'access_denied', state }), nonce, CONFIG, { transport: transportFor(store) }), '/dashboard/connections?zid_error=denied');
    const withCode = callback(store, state, { error: 'access_denied' });
    assert.equal(await completeZidCallback(withCode, nonce, CONFIG, { transport: transportFor(store) }), '/dashboard/connections?zid_error=denied', 'an error wins, even beside a code');
    assert.ok(store.codes.has(withCode.get('code')!), 'and that code is never exchanged');
    // A code used twice: Zid refuses it, and so do we.
    const used = callback(store, state);
    await completeZidCallback(used, nonce, CONFIG, { transport: transportFor(store) });
    assert.equal(await completeZidCallback(used, nonce, CONFIG, { transport: transportFor(store) }), '/dashboard/connections?zid_error=code');
    // Our own app keys refused: a setup fault, said so.
    assert.equal(await completeZidCallback(callback(store, state), nonce, { ...CONFIG, clientSecret: 'wrong' }, { transport: transportFor(store) }), '/dashboard/connections?zid_error=setup');
    // Zid down once the code is exchanged: back to Store connections, not an error page.
    const flaky = new ZidStore([]);
    const code = flaky.approve();
    const realFetch = flaky.fetch;
    const downAfterToken = (async (input: any, init?: any) => { const res = await realFetch(input, init); if (String(input).includes('/oauth/token')) flaky.down = true; return res; }) as typeof fetch;
    const t = new Transport('zid', { rate: { requests: 100_000, perMs: 1000 }, maxAttempts: 1 }, downAfterToken, instant);
    assert.equal(await completeZidCallback(new URLSearchParams({ code, state }), nonce, CONFIG, { transport: t }), '/dashboard/connections?zid_error=unavailable');
  } finally { await harness.close(); }
});

test('started from Store connections: only that store, by that person, finishes it; Growth and up', async () => {
  const harness = await createTestDb();
  try {
    const store = new ZidStore([]);
    const owner = await merchant(harness, 'oud');
    const stranger = await merchant(harness, 'other');
    const { authorizeUrl, nonce } = await startZidFromDashboard(owner.ctx, CONFIG);
    const ticket = ticketOf(await completeZidCallback(callback(store, stateOf(authorizeUrl)), nonce, CONFIG, { transport: transportFor(store) }))!;
    await assert.rejects(() => linkZidStore(stranger.ctx, ticket, CONFIG, { transport: transportFor(store) }), (e: any) => e.code === 'forbidden', 'the ticket is bound to who started it');
    assert.equal((await linkZidStore(owner.ctx, ticket, CONFIG, { transport: transportFor(store) })).status, 'active');

    const small = await merchant(harness, 'small', 'starter');
    await assert.rejects(() => startZidFromDashboard(small.ctx, CONFIG), (e: any) => e.code === 'plan_required');
    // A ticket from Activate (no one signed in) names only the store: the store still cannot be taken twice.
    const second = await startZid(CONFIG, null);
    assert.equal(await completeZidCallback(callback(store, stateOf(second.authorizeUrl)), second.nonce, CONFIG, { transport: transportFor(store) }), '/dashboard/connections?zid=renewed');
  } finally { await harness.close(); }
});

test('a link that is forged, expired or for another store is refused', async () => {
  const harness = await createTestDb();
  try {
    const store = new ZidStore([]);
    const { ctx } = await merchant(harness, 'oud');
    const { authorizeUrl, nonce } = await startZid(CONFIG, null);
    const ticket = ticketOf(await completeZidCallback(callback(store, stateOf(authorizeUrl)), nonce, CONFIG, { transport: transportFor(store) }))!;
    const [payload, mac] = ticket.split('.');
    const forbidden = (e: any) => e.code === 'forbidden';
    await assert.rejects(() => linkZidStore(ctx, `${Buffer.from(JSON.stringify({ m: '4', e: Date.now() + 60_000 })).toString('base64url')}.${mac}`, CONFIG, { transport: transportFor(store) }), forbidden);
    await assert.rejects(() => linkZidStore(ctx, `${payload}.x${mac!.slice(1)}`, CONFIG, { transport: transportFor(store) }), forbidden);
    await assert.rejects(() => linkZidStore(ctx, ticket, CONFIG, { transport: transportFor(store), now: Date.now() + 11 * 60_000 }), forbidden);
    // The waiting tokens now open another store (Zid says so): never crossed.
    const other = new ZidStore([]);
    other.storeTitle = 'x';
    const moved = (async (input: any, init?: any) => {
      const res = await store.fetch(input, init);
      if (!String(input).includes('/managers/account/profile')) return res;
      const body = await res.json() as any; body.user.store.id = 4; return Response.json(body);
    }) as typeof fetch;
    await assert.rejects(() => linkZidStore(ctx, ticket, CONFIG, { transport: new Transport('zid', { rate: { requests: 100_000, perMs: 1000 } }, moved, instant) }), forbidden);
    assert.equal((await rows(harness, storeGrants)).length, 1, 'a refused link leaves the waiting access as it was');
  } finally { await harness.close(); }
});

test('the endpoints: Activate sets the one-time cookie and goes straight to Zid; the callback always lands on Store connections and clears it', async () => {
  const activate = await activateZidHandler(new Request('https://app.tajribah.sa/api/connections/zid/activate'));
  assert.equal(activate.status, 302);
  assert.match(activate.headers.get('location') ?? '', /^https:\/\/oauth\.zid\.sa\/oauth\/authorize\?/);
  const cookie = activate.headers.get('set-cookie') ?? '';
  assert.match(cookie, new RegExp(`^${ZID_STATE_COOKIE}=[0-9a-f]{32}; Path=/api/connections/zid; HttpOnly; SameSite=Lax; Max-Age=600; Secure$`));

  const back = await zidCallbackHandler(new Request('https://app.tajribah.sa/api/connections/zid/callback?code=x&state=forged', { headers: { cookie: 'other=1' } }));
  assert.equal(back.status, 302);
  assert.equal(back.headers.get('location'), 'https://app.tajribah.sa/dashboard/connections?zid_error=state');
  assert.match(back.headers.get('set-cookie') ?? '', new RegExp(`^${ZID_STATE_COOKIE}=; .*Max-Age=0`));
  assert.equal(back.headers.get('referrer-policy'), 'no-referrer', 'the code in the address goes nowhere else');
});
