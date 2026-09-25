/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { configureNotify } from '@/server/core/notify/notify';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb } from '@/server/testing/harness';
import { registerHandler } from '@/server/modules/auth/http';
import { connectStore } from '@/server/modules/connections/service';
import { disconnectHandler, listConnectionsHandler, requestSyncHandler } from '@/server/modules/connections/http';

setLogLevel('error');
const APP = 'http://localhost:5173';

async function signUp(email: string, storeName: string) {
  const original = console.log;
  console.log = () => {};
  try {
    const response = await registerHandler(new Request(`${APP}/api/auth/register`, {
      method: 'POST', headers: { origin: APP, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password: 'a-long-enough-password', fullName: 'O', storeName }),
    }));
    const body = await response.json() as any;
    const ctx = await buildTenantContext({ actor: { userId: body.user.id, email, isStaff: false }, tenantId: body.tenant.id, requestId: 'r' });
    return { auth: { authorization: `Bearer ${body.accessToken}`, origin: APP }, ctx };
  } finally { console.log = original; }
}

const list = async (auth: Record<string, string>) =>
  (await (await listConnectionsHandler(new Request(`${APP}/api/connections`, { headers: auth }))).json() as any).connections;
const sync = (auth: Record<string, string>, id: string) =>
  requestSyncHandler(new Request(`${APP}/api/connections/${id}/sync`, { method: 'POST', headers: auth }));
const disconnect = (auth: Record<string, string>, id: string) =>
  disconnectHandler(new Request(`${APP}/api/connections/${id}`, { method: 'DELETE', headers: auth }));

test('over HTTP: list with sync and webhook health, sync now (once), disconnect, and refusals', async () => {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
  setRateLimiter(new MemoryRateLimiter());
  const harness = await createTestDb();
  try {
    const a = await signUp('a@example.test', 'Alpha');
    const b = await signUp('b@example.test', 'Beta');
    const made = await connectStore(a.ctx, { provider: 'salla', externalStoreId: 's-1', storeName: 'Alpha on Salla', tokens: { accessToken: 'secret-access', refreshToken: 'secret-refresh' } });

    const [first] = await list(a.auth);
    assert.deepEqual([first.id, first.status, first.latestSync, first.webhooks.last24h.processed], [made.id, 'active', null, 0]);
    const raw = JSON.stringify(await list(a.auth));
    assert.ok(!/token|secret-/i.test(raw), 'no token field and no token value in what the API returns');

    const queued = await sync(a.auth, made.id);
    assert.equal(queued.status, 202);
    const progress = await queued.json() as any;
    assert.deepEqual([progress.status, progress.type, progress.triggeredBy], ['queued', 'full', 'user'], 'first sync of a store is full');
    assert.equal((await (await sync(a.auth, made.id)).json() as any).id, progress.id, 'asking again returns the same sync');
    assert.equal((await list(a.auth))[0].latestSync.id, progress.id);

    assert.equal((await sync(b.auth, made.id)).status, 404, "another store's connection does not exist for them");
    assert.equal((await disconnect(b.auth, made.id)).status, 404);
    assert.deepEqual(await list(b.auth), []);
    assert.equal((await sync(a.auth, 'not-a-uuid')).status, 404);
    assert.equal((await listConnectionsHandler(new Request(`${APP}/api/connections`))).status, 401);
    assert.equal((await sync({ ...a.auth, origin: 'https://evil.example' }, made.id)).status, 403, 'cross-site sync refused');

    assert.equal((await disconnect(a.auth, made.id)).status, 204);
    const [after] = await list(a.auth);
    assert.equal(after.status, 'revoked');
    assert.equal((await sync(a.auth, made.id)).status, 409, 'a disconnected store cannot sync');
  } finally { await harness.close(); resetEnv(); }
});
