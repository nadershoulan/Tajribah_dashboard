/* eslint-disable @typescript-eslint/no-explicit-any */
// Filed in STATE.md (P1.3): changing ENCRYPTION_KEY used to make every stored token unreadable.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { storeConnections } from '@/db/schema';
import { encryptionKeyId } from '@/server/core/auth/crypto';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { accessTokenFor, connectStore, ReconnectRequiredError } from '@/server/modules/connections/service';
import { resealConnections } from '@/server/modules/connections/rotation';

setLogLevel('error');
const OLD = 'o'.repeat(40);
const NEW = 'n'.repeat(40);
const useKeys = (current: string, previous?: string) => {
  resetEnv();
  loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: current, ...(previous ? { ENCRYPTION_KEY_PREVIOUS: previous } : {}) });
};
const raw = (harness: TestDb, id: string): Promise<any> =>
  harness.asAdmin(async () => (await harness.db.select().from(storeConnections).where(eq(storeConnections.id, id)))[0]);
const kidOf = (envelope: string | null) => envelope?.split('.')[1];

async function connected(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  const summary = await connectStore(ctx, {
    provider: 'salla', externalStoreId: `store-${name}`,
    tokens: { accessToken: `access-${name}`, refreshToken: `refresh-${name}`, expiresAt: new Date(Date.now() + 86_400_000) },
  });
  return { ctx, id: summary.id };
}

test('rotating the key: tokens sealed under the old key keep working, and move to the new key on use', async () => {
  const harness = await createTestDb();
  try {
    useKeys(OLD);
    const { ctx, id } = await connected(harness, 'alpha');
    assert.equal(kidOf((await raw(harness, id)).accessTokenEncrypted), await encryptionKeyId(OLD));

    useKeys(NEW, OLD);
    assert.equal(await accessTokenFor(ctx, id), 'access-alpha');
    const row = await raw(harness, id);
    assert.equal(kidOf(row.accessTokenEncrypted), await encryptionKeyId(NEW), 'used once, re-sealed under the new key');
    assert.equal(kidOf(row.refreshTokenEncrypted), await encryptionKeyId(NEW));

    useKeys(NEW); // the old key retired
    assert.equal(await accessTokenFor(ctx, id), 'access-alpha');
    assert.equal((await raw(harness, id)).status, 'active');
  } finally { useKeys(OLD); await harness.close(); }
});

test('the sweep re-seals idle connections, so the old key can be retired', async () => {
  const harness = await createTestDb();
  try {
    useKeys(OLD);
    const a = await connected(harness, 'alpha');
    const b = await connected(harness, 'beta');

    useKeys(NEW, OLD);
    assert.deepEqual(await resealConnections(), { resealed: 2, unreadable: 0 });
    for (const { id } of [a, b]) assert.equal(kidOf((await raw(harness, id)).accessTokenEncrypted), await encryptionKeyId(NEW));
    assert.deepEqual(await resealConnections(), { resealed: 0, unreadable: 0 }, 'nothing left under the old key');

    useKeys(NEW);
    assert.equal(await accessTokenFor(b.ctx, b.id), 'access-beta');
  } finally { useKeys(OLD); await harness.close(); }
});

test('without the previous key, old tokens are unreadable and the merchant must reconnect (unchanged)', async () => {
  const harness = await createTestDb();
  try {
    useKeys(OLD);
    const { ctx, id } = await connected(harness, 'alpha');
    useKeys(NEW);
    assert.deepEqual(await resealConnections(), { resealed: 0, unreadable: 1 }, 'the sweep counts it and leaves it for use to mark');
    await assert.rejects(accessTokenFor(ctx, id), ReconnectRequiredError);
    assert.equal((await raw(harness, id)).status, 'error');
  } finally { useKeys(OLD); await harness.close(); }
});
