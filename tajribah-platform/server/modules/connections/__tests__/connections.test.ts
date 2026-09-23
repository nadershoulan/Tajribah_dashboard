/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, storeConnections, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { clearConnectors, registerConnector, TokenRevokedError, type TokenSet } from '@/server/connectors/types';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { errors } from '@/server/core/errors/problem';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import {
  accessTokenFor, connectStore, disconnectStore, listConnections, REFRESH_SKEW_MS, ReconnectRequiredError,
} from '@/server/modules/connections/service';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });

async function store(harness: TestDb, name: string, role: 'owner' | 'viewer' = 'owner') {
  const seeded = await seedTenant(harness, name);
  let userId = seeded.userId;
  if (role !== 'owner') {
    userId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: userId, email: `${role}-${name}@example.test`, passwordHash: 'x', fullName: role } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: seeded.tenantId, userId, role, status: 'active' } as any);
    });
  }
  const ctx = await buildTenantContext({ actor: { userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx };
}

const raw = (harness: TestDb, id: string): Promise<any> =>
  harness.asAdmin(async () => (await harness.db.select().from(storeConnections).where(eq(storeConnections.id, id)))[0]);
const code = (e: any) => e.code;
const NOW = new Date('2026-09-23T12:00:00Z');
const inMinutes = (m: number) => new Date(NOW.getTime() + m * 60_000);

/**
 * A Salla-like connector: every refresh rotates the refresh token and refuses the old one,
 * the way a real store does after a leak. `calls` counts refreshes that reached "the store".
 */
function rotatingStore(opts: { down?: boolean; revoked?: boolean } = {}) {
  let current = 'refresh-1';
  const fake = {
    calls: 0,
    async refresh(tokens: TokenSet): Promise<TokenSet> {
      fake.calls += 1;
      await new Promise((r) => setTimeout(r, 5));
      if (opts.down) throw errors.upstream('salla');
      if (opts.revoked || tokens.refreshToken !== current) throw new TokenRevokedError('refresh token refused');
      current = `refresh-${fake.calls + 1}`;
      return { accessToken: `access-${fake.calls + 1}`, refreshToken: current, expiresAt: inMinutes(60) };
    },
  };
  clearConnectors();
  registerConnector({ provider: 'salla', refresh: (t) => fake.refresh(t), listProducts: async () => ({ items: [], next: null }), getProduct: async () => null });
  return fake;
}

const TOKENS = { accessToken: 'access-1', refreshToken: 'refresh-1', expiresAt: inMinutes(60), scopes: ['products.read_write'] };

test('tokens are stored sealed: not in the row, not in the audit trail, not in the summary', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    const made = await connectStore(ctx, { provider: 'salla', externalStoreId: 'salla-1', storeName: 'Alpha Watches', tokens: TOKENS });
    assert.equal(made.status, 'active');
    assert.equal(made.storeName, 'Alpha Watches');
    assert.deepEqual(Object.keys(made).filter((k) => /token/i.test(k)), [], 'no token field in what the API can return');

    const row = await raw(harness, made.id);
    const stored = JSON.stringify(row);
    assert.ok(!stored.includes('access-1') && !stored.includes('refresh-1'), 'no plaintext at rest');
    assert.match(row.accessTokenEncrypted, /^v1\./);
    assert.deepEqual(row.scopes, ['products.read_write']);

    const trail = await harness.asAdmin(() => harness.db.select().from(auditLogs));
    const connect = trail.filter((r) => r.resourceType === 'store_connection');
    assert.deepEqual(connect.map((r) => r.action), ['connect']);
    assert.ok(!JSON.stringify(connect).includes(row.accessTokenEncrypted.slice(3, 20)), 'not even the ciphertext is audited');

    assert.equal(await accessTokenFor(ctx, made.id, NOW), 'access-1');
    assert.deepEqual((await listConnections(ctx)).map((c) => c.id), [made.id]);
  } finally { await harness.close(); }
});

test('one store, one account: another account is refused; the same account reconnects the same row', async () => {
  const harness = await createTestDb();
  try {
    const a = await store(harness, 'alpha');
    const b = await store(harness, 'beta');
    const first = await connectStore(a.ctx, { provider: 'salla', externalStoreId: 'salla-1', tokens: TOKENS });
    await assert.rejects(() => connectStore(b.ctx, { provider: 'salla', externalStoreId: 'salla-1', tokens: { accessToken: 'b-token' } }),
      (e: any) => code(e) === 'conflict');
    assert.deepEqual(await listConnections(b.ctx), []);
    assert.equal(await accessTokenFor(a.ctx, first.id, NOW), 'access-1', "the first account's tokens are untouched");

    await disconnectStore(a.ctx, first.id);
    const again = await connectStore(a.ctx, { provider: 'salla', externalStoreId: 'salla-1', tokens: { ...TOKENS, accessToken: 'access-new' } });
    assert.equal(again.id, first.id);
    assert.equal(again.status, 'active');
    assert.equal(await accessTokenFor(a.ctx, first.id, NOW), 'access-new');
    await assert.rejects(() => accessTokenFor(b.ctx, first.id, NOW), (e: any) => code(e) === 'not_found', "another account cannot use it by id");
  } finally { await harness.close(); }
});

test('only roles with connections:write connect or disconnect', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    const v = await store(harness, 'gamma', 'viewer');
    await assert.rejects(() => connectStore(v.ctx, { provider: 'salla', externalStoreId: 'g-1', tokens: TOKENS }), (e: any) => code(e) === 'forbidden');
    const made = await connectStore(ctx, { provider: 'salla', externalStoreId: 'a-1', tokens: TOKENS });
    await disconnectStore(ctx, made.id);
    const row = await raw(harness, made.id);
    assert.equal(row.status, 'revoked');
    assert.equal(row.accessTokenEncrypted, null);
    assert.equal(row.refreshTokenEncrypted, null);
    await assert.rejects(() => accessTokenFor(ctx, made.id, NOW), (e: any) => e instanceof ReconnectRequiredError);
  } finally { await harness.close(); }
});

test('a ciphertext moved onto another connection does not open there', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    const one = await connectStore(ctx, { provider: 'salla', externalStoreId: 's-1', tokens: TOKENS });
    const two = await connectStore(ctx, { provider: 'salla', externalStoreId: 's-2', tokens: { accessToken: 'other' } });
    const stolen = (await raw(harness, one.id)).accessTokenEncrypted;
    await harness.asAdmin(() => harness.db.update(storeConnections).set({ accessTokenEncrypted: stolen }).where(eq(storeConnections.id, two.id)));

    await assert.rejects(() => accessTokenFor(ctx, two.id, NOW), (e: any) => e instanceof ReconnectRequiredError && e.connectionStatus === 'error');
    const row = await raw(harness, two.id);
    assert.equal(row.status, 'error');
    assert.equal(row.accessTokenEncrypted, null, 'unreadable tokens are wiped, not kept around');
    assert.equal(await accessTokenFor(ctx, one.id, NOW), 'access-1');
  } finally { await harness.close(); }
});

test('refresh: only near expiry, stored sealed, and concurrent callers share one refresh', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    const fake = rotatingStore();
    const made = await connectStore(ctx, { provider: 'salla', externalStoreId: 's-1', tokens: { ...TOKENS, expiresAt: inMinutes(30) } });

    assert.equal(await accessTokenFor(ctx, made.id, NOW), 'access-1');
    assert.equal(fake.calls, 0, '30 minutes left: no refresh');

    const soon = new Date(inMinutes(30).getTime() - REFRESH_SKEW_MS + 1);
    const tokens = await Promise.all([accessTokenFor(ctx, made.id, soon), accessTokenFor(ctx, made.id, soon), accessTokenFor(ctx, made.id, soon)]);
    assert.deepEqual(tokens, ['access-2', 'access-2', 'access-2']);
    assert.equal(fake.calls, 1, 'a second refresh would have used a rotated-out token and looked like a revocation');

    const row = await raw(harness, made.id);
    assert.equal(row.status, 'active');
    assert.ok(!JSON.stringify(row).includes('refresh-2'));
    assert.deepEqual(row.scopes, ['products.read_write'], 'scopes kept when the refresh omits them');
  } finally { clearConnectors(); await harness.close(); }
});

test('refresh refused by the store: tokens wiped, marked revoked, audited, and the store is not asked again', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    const fake = rotatingStore({ revoked: true });
    const made = await connectStore(ctx, { provider: 'salla', externalStoreId: 's-1', tokens: { ...TOKENS, expiresAt: NOW } });

    await assert.rejects(() => accessTokenFor(ctx, made.id, NOW), (e: any) => e instanceof ReconnectRequiredError && e.connectionStatus === 'revoked' && e.status === 409);
    const row = await raw(harness, made.id);
    assert.equal(row.status, 'revoked');
    assert.equal(row.accessTokenEncrypted, null);
    assert.match(row.lastError, /revoked/);
    const trail = await harness.asAdmin(() => harness.db.select().from(auditLogs));
    const change = trail.find((r) => r.resourceType === 'store_connection' && r.action === 'update');
    assert.equal((change as any)?.changes?.after?.status, 'revoked');
    assert.equal(change?.actorType, 'system', 'the store did this, not the person whose request noticed');

    await assert.rejects(() => accessTokenFor(ctx, made.id, NOW), (e: any) => e instanceof ReconnectRequiredError);
    assert.equal(fake.calls, 1);
  } finally { clearConnectors(); await harness.close(); }
});

test('refresh when the store is down: the error passes through and nothing changes', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    rotatingStore({ down: true });
    const made = await connectStore(ctx, { provider: 'salla', externalStoreId: 's-1', tokens: { ...TOKENS, expiresAt: NOW } });
    const before = await raw(harness, made.id);
    await assert.rejects(() => accessTokenFor(ctx, made.id, NOW), (e: any) => code(e) === 'upstream_unavailable');
    const after = await raw(harness, made.id);
    assert.equal(after.status, 'active');
    assert.equal(after.refreshTokenEncrypted, before.refreshTokenEncrypted);
  } finally { clearConnectors(); await harness.close(); }
});

test('expired with no refresh token: marked expired, merchant must reconnect', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    const made = await connectStore(ctx, { provider: 'salla', externalStoreId: 's-1', tokens: { accessToken: 'a', expiresAt: NOW } });
    await assert.rejects(() => accessTokenFor(ctx, made.id, NOW), (e: any) => e.connectionStatus === 'expired');
    assert.equal((await listConnections(ctx))[0].status, 'expired');
  } finally { await harness.close(); }
});
