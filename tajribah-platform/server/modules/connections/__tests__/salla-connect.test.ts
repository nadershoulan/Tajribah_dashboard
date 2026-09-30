/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T61 (P1.4) — connecting a Salla store the way Salla allows published apps: the tokens arrive by a
 * signed webhook on install (and wait, sealed, while no account has the store); Salla proves the store
 * when the merchant opens our app page inside its dashboard; the merchant's own session links it.
 * Every step is refused when its proof is missing, and the tokens are never stored in the clear.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { auditLogs, storeConnections, storeGrants, syncJobs, webhookEvents } from '@/db/schema';
import { Transport, type Clock } from '@/server/connectors/transport';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { SALLA_APP_ID, SALLA_MERCHANT, SallaStore } from '@/server/testing/salla-store';
import { accessTokenFor, connectStore, vaultKeys } from '@/server/modules/connections/service';
import { LINK_TTL_MS, authorizeTokens, introspectSalla, linkSallaStore, openSallaApp, signLinkTicket } from '@/server/modules/connections/salla';
import { openTokens } from '@/server/modules/connections/vault';
import { receiveWebhookHandler } from '@/server/modules/webhooks/http';
import { clearWebhookSources, registerWebhookSource } from '@/server/modules/webhooks/sources';
import { sallaSource } from '@/server/modules/webhooks/salla';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });

const SECRET = 'salla_webhook_secret';
const AUTH_SECRET = 's'.repeat(40);
const LINK = { appId: SALLA_APP_ID, authSecret: AUTH_SECRET };
clearWebhookSources();
registerWebhookSource(sallaSource(SECRET));

const instant: Clock = { now: () => Date.now(), sleep: async () => {}, random: () => 0 };
const transportFor = (store: SallaStore) => new Transport('salla', { rate: { requests: 100_000, perMs: 1000 } }, store.fetch, instant);

async function deliver(body: unknown) {
  const raw = JSON.stringify(body);
  const response = await receiveWebhookHandler(new Request('http://localhost:5173/api/webhooks/salla', {
    method: 'POST', body: raw,
    headers: { 'content-type': 'application/json', 'x-salla-security-strategy': 'Signature', 'x-salla-signature': createHmac('sha256', SECRET).update(raw).digest('hex') },
  }));
  return { status: response.status, body: await response.json() as any };
}
const authorize = (merchant: number, access = 'salla_at_ok', refresh = 'salla_rt_ok') => ({
  event: 'app.store.authorize', merchant, created_at: '2026-09-30 12:31:25',
  data: { access_token: access, expires: Math.floor(Date.now() / 1000) + 1_209_599, refresh_token: refresh, scope: 'settings.read products.read offline_access', token_type: 'bearer' },
});

async function merchant(harness: TestDb, name: string, plan: 'starter' | 'pro' = 'pro') {
  const seeded = await seedTenant(harness, name, { plan });
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `r-${name}` });
  return { ...seeded, ctx };
}
const rows = (harness: TestDb, table: any): Promise<any[]> => harness.asAdmin(() => harness.db.select().from(table) as any);

test('install, open inside Salla, link: the store connects with its tokens, and its first sync starts', async () => {
  const harness = await createTestDb();
  try {
    const store = new SallaStore([]);
    const { ctx } = await merchant(harness, 'oud');

    // 1. The merchant installs the app: Salla sends the store's tokens. No account has the store yet.
    const installed = await deliver(authorize(SALLA_MERCHANT));
    assert.deepEqual([installed.status, installed.body.outcome], [200, 'unknown_store']);
    const [grant] = await rows(harness, storeGrants);
    assert.deepEqual([grant.provider, grant.externalStoreId], ['salla', String(SALLA_MERCHANT)]);
    assert.ok(!JSON.stringify(grant).includes('salla_at_ok') && !JSON.stringify(grant).includes('salla_rt_ok'), 'sealed, never in the clear');
    assert.deepEqual((await openTokens(grant, vaultKeys()))?.refreshToken, 'salla_rt_ok', 'and bound to the waiting row');
    assert.equal((await rows(harness, webhookEvents)).length, 0, 'no event row for a store nobody has');

    // 2. The merchant opens Tajribah inside Salla: Salla says which store this is.
    const opened = await openSallaApp('em_tok_ok', LINK, { transport: transportFor(store) });
    assert.deepEqual([opened.linked, opened.ready, typeof opened.ticket], [false, true, 'string']);

    // 3. Signed in to Tajribah, the merchant links it.
    const connection = await linkSallaStore(ctx, opened.ticket!, LINK, { transport: transportFor(store) });
    assert.deepEqual([connection.provider, connection.status, connection.storeName, connection.storeUrl], ['salla', 'active', 'بيت العود', 'https://oud-house.example.sa']);
    const [row] = await rows(harness, storeConnections);
    assert.equal(row.externalStoreId, String(SALLA_MERCHANT), 'the store Salla vouched for');
    assert.equal(await accessTokenFor(ctx, connection.id), 'salla_at_ok', 'the connection opens the store');
    assert.equal((await rows(harness, storeGrants)).length, 0, 'the waiting row is gone');
    assert.deepEqual((await rows(harness, syncJobs)).map((s) => [s.type, s.triggeredBy]), [['full', 'user']]);

    // Opened again from Salla: already linked, no ticket.
    assert.deepEqual(await openSallaApp('em_tok_ok', LINK, { transport: transportFor(store) }), { linked: true, ready: true, ticket: null });
    // The ticket is spent: its grant went with it.
    await assert.rejects(() => linkSallaStore(ctx, opened.ticket!, LINK, { transport: transportFor(store) }), (e: any) => e.code === 'conflict' && /already linked/.test(e.message));
  } finally { await harness.close(); }
});

test('each proof is required: Salla’s word on the session, our signature on the ticket, its time, the store the tokens open', async () => {
  const harness = await createTestDb();
  try {
    const store = new SallaStore([]);
    const { ctx } = await merchant(harness, 'oud');
    await deliver(authorize(SALLA_MERCHANT));

    const forbidden = (e: any) => e.code === 'forbidden';
    await assert.rejects(() => openSallaApp('em_tok_forged', LINK, { transport: transportFor(store) }), forbidden, 'a session Salla does not know');
    await assert.rejects(() => openSallaApp('em_tok_ok', { ...LINK, appId: '999' }, { transport: transportFor(store) }), forbidden, 'Salla answers only for our app id');

    const good = await signLinkTicket(String(SALLA_MERCHANT), AUTH_SECRET);
    const [payload, mac] = good.split('.');
    const other = Buffer.from(JSON.stringify({ m: '42', e: Date.now() + LINK_TTL_MS })).toString('base64url');
    for (const ticket of [`${other}.${mac}`, `${payload}.${mac!.slice(0, -2)}xx`, 'nonsense', await signLinkTicket(String(SALLA_MERCHANT), 'another-secret'.repeat(3))]) {
      await assert.rejects(() => linkSallaStore(ctx, ticket, LINK, { transport: transportFor(store) }), forbidden, ticket);
    }
    const old = await signLinkTicket(String(SALLA_MERCHANT), AUTH_SECRET, Date.now() - LINK_TTL_MS - 1);
    await assert.rejects(() => linkSallaStore(ctx, old, LINK, { transport: transportFor(store) }), forbidden, 'ten minutes, then open Tajribah from Salla again');

    // The waiting tokens open another store than the ticket names: never crossed.
    store.merchant = 555;
    await assert.rejects(() => linkSallaStore(ctx, good, LINK, { transport: transportFor(store) }), forbidden);
    store.merchant = SALLA_MERCHANT;
    assert.equal((await rows(harness, storeGrants)).length, 1, 'a refused link leaves the waiting access as it was');

    // Salla has sent nothing for this store yet.
    const nothingYet = await signLinkTicket('777', AUTH_SECRET);
    await assert.rejects(() => linkSallaStore(ctx, nothingYet, LINK, { transport: transportFor(store) }), (e: any) => e.code === 'conflict' && /not handed over/.test(e.message));

    // Salla from Growth: a Starter store cannot link one (T35).
    const starter = await merchant(harness, 'small', 'starter');
    const asked = store.requests;
    await assert.rejects(() => linkSallaStore(starter.ctx, good, LINK, { transport: transportFor(store) }), (e: any) => e.code === 'plan_required');
    assert.equal(store.requests, asked, 'refused before Salla is asked anything');
    // Someone without connections:write cannot either — nothing changes.
    assert.equal((await rows(harness, storeConnections)).length, 0);
  } finally { await harness.close(); }
});

test('a store already linked elsewhere stays there; the waiting access stays until it is used or withdrawn', async () => {
  const harness = await createTestDb();
  try {
    const store = new SallaStore([]);
    const first = await merchant(harness, 'first');
    const second = await merchant(harness, 'second');
    await deliver(authorize(SALLA_MERCHANT));
    const ticket = await signLinkTicket(String(SALLA_MERCHANT), AUTH_SECRET);
    await linkSallaStore(first.ctx, ticket, LINK, { transport: transportFor(store) });

    // A second install message (the merchant reinstalled): the linked connection takes the new tokens.
    await deliver(authorize(SALLA_MERCHANT, 'salla_at_new', 'salla_rt_new'));
    const [connection] = await rows(harness, storeConnections);
    assert.equal(await accessTokenFor(first.ctx, connection.id), 'salla_at_new');
    const [event] = await rows(harness, webhookEvents);
    assert.equal(event.payload.data.access_token, '[redacted]', 'the event is kept, without the tokens');
    assert.equal((await rows(harness, storeGrants)).length, 0, 'nothing waits for a linked store');

    // Another account cannot take it with a ticket of its own.
    await deliver(authorize(SALLA_MERCHANT)); // goes to the connection, not a grant
    await assert.rejects(() => linkSallaStore(second.ctx, ticket, LINK, { transport: transportFor(store) }), (e: any) => e.code === 'conflict');

    // Uninstalled before linking: the waiting access is withdrawn.
    await deliver(authorize(1328842359, 'salla_at_b', 'salla_rt_b'));
    assert.equal((await rows(harness, storeGrants)).length, 1);
    await deliver({ event: 'app.uninstalled', merchant: 1328842359, created_at: '2026-09-30 13:00:00', data: { id: 6789012345, app_name: 'Tajribah' } });
    assert.equal((await rows(harness, storeGrants)).length, 0);

    // A revoked connection comes back when Salla re-authorizes it.
    await harness.asAdmin(() => harness.db.update(storeConnections).set({ status: 'revoked', accessTokenEncrypted: null, refreshTokenEncrypted: null } as any).where(eq(storeConnections.id, connection.id)));
    await deliver(authorize(SALLA_MERCHANT, 'salla_at_back', 'salla_rt_back'));
    assert.equal(await accessTokenFor(first.ctx, connection.id), 'salla_at_back');
    const trail = await rows(harness, auditLogs);
    assert.ok(trail.some((a) => a.resourceType === 'store_connection' && a.resourceId === connection.id && a.action === 'update' && a.actorType === 'system' && a.changes?.after?.status === 'active'), 'the store coming back is on the record, as Salla’s doing');
  } finally { await harness.close(); }
});

test('the install message’s tokens: a Unix expiry, the scopes; nothing usable without both tokens', async () => {
  const now = Date.UTC(2026, 8, 30, 12);
  const t = authorizeTokens({ access_token: 'a', refresh_token: 'r', expires: 1_634_819_484, scope: 'products.read offline_access' }, now)!;
  assert.equal(t.expiresAt?.toISOString(), '2021-10-21T12:31:24.000Z', 'a Unix time, as Salla notes for this event');
  assert.deepEqual(t.scopes, ['products.read', 'offline_access']);
  assert.equal(authorizeTokens({ access_token: 'a', refresh_token: 'r', expires: 1_209_599 }, now)!.expiresAt?.getTime(), now + 1_209_599_000, 'seconds from now, should Salla send those');
  assert.equal(authorizeTokens({ access_token: 'a' }), null);
  assert.equal(authorizeTokens({ refresh_token: 'r' }), null);
  assert.equal(authorizeTokens(null), null);
  // A second store's install cannot overwrite the first's waiting access (one row per store).
  const harness = await createTestDb();
  try {
    await deliver(authorize(1, 'at_one', 'rt_one'));
    await deliver(authorize(2, 'at_two', 'rt_two'));
    await deliver(authorize(1, 'at_one_again', 'rt_one_again'));
    const grants = await rows(harness, storeGrants);
    assert.deepEqual(grants.map((g) => g.externalStoreId).sort(), ['1', '2']);
    const one = grants.find((g) => g.externalStoreId === '1');
    assert.equal((await openTokens(one, vaultKeys()))?.accessToken, 'at_one_again');
    // Connecting store 2 directly (as the service does after linking) leaves store 1's access waiting.
    const { ctx } = await merchant(harness, 'two');
    await connectStore(ctx, { provider: 'salla', externalStoreId: '2', tokens: { accessToken: 'x', refreshToken: 'y' } });
    assert.equal((await rows(harness, storeGrants)).length, 2);
  } finally { await harness.close(); }
});

test('Salla’s introspect: only a successful answer naming a store counts', async () => {
  const answering = (status: number, body: unknown) => new Transport('salla', { rate: { requests: 100_000, perMs: 1000 } }, (async () => Response.json(body, { status })) as typeof fetch, instant);
  assert.equal(await introspectSalla('t', SALLA_APP_ID, answering(200, { status: 200, success: true, data: { merchant_id: 123456, user_id: 987654, exp: '2026-10-01T12:00:00Z' } })), '123456');
  const forbidden = (e: any) => e.code === 'forbidden';
  // Salla documents a failure inside a 200 too.
  await assert.rejects(() => introspectSalla('t', SALLA_APP_ID, answering(200, { status: 401, success: false, error: { message: 'Decryption failed', code: 0 } })), forbidden);
  await assert.rejects(() => introspectSalla('t', SALLA_APP_ID, answering(200, { status: 200, success: false, data: { merchant_id: 123456 } })), forbidden, 'not successful, whatever else it says');
  await assert.rejects(() => introspectSalla('t', SALLA_APP_ID, answering(401, { status: 401, success: false, data: { merchant_id: 123456 } })), forbidden);
  // What the real server answers to a token it cannot read (checked 2026-09-30).
  await assert.rejects(() => introspectSalla('t', SALLA_APP_ID, answering(422, { status: 422, success: false, error: { message: 'Decryption failed', code: 0 } })), forbidden);
  await assert.rejects(() => introspectSalla('t', SALLA_APP_ID, answering(200, { status: 200, success: true, data: { merchant_id: 'not-a-store' } })), forbidden);
  await assert.rejects(() => introspectSalla('', SALLA_APP_ID, answering(200, {})), forbidden, 'no token, no question');
  await assert.rejects(() => introspectSalla('t', SALLA_APP_ID, answering(503, {})), (e: any) => e.code?.startsWith('upstream_'), 'Salla down: try again, not refused');
});
