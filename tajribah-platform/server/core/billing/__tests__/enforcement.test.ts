/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T35 — the plan's features are enforced where they are used: store platforms (Salla and Zid from
 * Growth — the trial runs on Growth — Shopify and WooCommerce from Pro) for connecting and for every
 * sync, asked for or scheduled; AI 3D work from Pro, refused before anything is charged.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { creditLedger, storeConnections, syncJobs } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { connectStore } from '@/server/modules/connections/service';
import { requestSync } from '@/server/modules/sync/service';
import { scheduleSyncs } from '@/server/modules/sync/schedule';
import { createAiJob } from '@/server/modules/ai-jobs/lifecycle';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'http://localhost:5173', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });

const TOKENS = { accessToken: 'access', refreshToken: 'refresh', expiresAt: new Date(Date.now() + 3_600_000) };
const refused = (feature: string) => (e: any) => e.code === 'plan_required' && new RegExp(feature).test(e.message);

async function storeOn(harness: TestDb, name: string, plan: 'starter' | 'trial' | 'growth' | 'pro') {
  const seeded = await seedTenant(harness, name, plan === 'growth' || plan === 'pro' ? { plan } : {});
  if (plan === 'trial') await harness.asAdmin(() => harness.db.execute(sql`update tenants set status = 'trial', trial_ends_at = now() + interval '14 days' where id = ${seeded.tenantId}`));
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `r-${name}` });
  return { ...seeded, ctx };
}

test('connecting a store platform follows the plan: Salla and Zid from Growth (the trial too), Shopify and WooCommerce from Pro', async () => {
  const harness = await createTestDb();
  try {
    const starter = await storeOn(harness, 'starter', 'starter');
    await assert.rejects(() => connectStore(starter.ctx, { provider: 'salla', externalStoreId: 's-1', tokens: TOKENS }), refused('salla'));
    const trial = await storeOn(harness, 'trial', 'trial');
    assert.ok(await connectStore(trial.ctx, { provider: 'zid', externalStoreId: 'z-1', tokens: TOKENS }), 'the trial runs on Growth: Zid connects');
    const growth = await storeOn(harness, 'growth', 'growth');
    await assert.rejects(() => connectStore(growth.ctx, { provider: 'shopify', externalStoreId: 'sh-1', tokens: TOKENS }), refused('shopify'));
    const pro = await storeOn(harness, 'pro', 'pro');
    assert.ok(await connectStore(pro.ctx, { provider: 'woocommerce', externalStoreId: 'w-1', tokens: TOKENS }));
    const rows = await harness.asAdmin(() => harness.db.select().from(storeConnections));
    assert.deepEqual(rows.map((r) => r.provider).sort(), ['woocommerce', 'zid'], 'refused ones leave nothing behind');
  } finally { await harness.close(); }
});

test('a store whose plan lost its platform: "sync now" is refused, and the schedule skips it quietly', async () => {
  const harness = await createTestDb();
  try {
    const starter = await storeOn(harness, 'starter', 'starter');
    const growth = await storeOn(harness, 'growth', 'growth');
    const connect = (tenantId: string, name: string) => harness.asAdmin(async () => {
      const id = uuidv7();
      await harness.db.insert(storeConnections).values({ id, tenantId, provider: 'salla', externalStoreId: `${name}-store`, status: 'active', accessTokenEncrypted: 'x' } as any);
      return id;
    });
    const lost = await connect(starter.tenantId, 'starter'); // connected on the trial, then moved to Starter
    const kept = await connect(growth.tenantId, 'growth');
    await assert.rejects(() => requestSync(starter.ctx, lost), refused('salla'));
    const result = await scheduleSyncs(new Date());
    assert.equal(result.scheduled, 1, 'only the Growth store gets its scheduled sync');
    const jobs = await harness.asAdmin(() => harness.db.select().from(syncJobs));
    assert.deepEqual(jobs.map((j) => j.connectionId), [kept]);
  } finally { await harness.close(); }
});

test('AI 3D work is Pro and up, refused before anything is charged', async () => {
  const harness = await createTestDb();
  try {
    const growth = await storeOn(harness, 'growth', 'growth');
    await assert.rejects(() => createAiJob(growth.ctx, { type: 'generate_3d', input: { productId: 'p' }, creditsCost: 2 }), refused('ai_3d'));
    const spent = async (tenantId: string) => (await harness.asAdmin(() => harness.db.select().from(creditLedger).where(eq(creditLedger.tenantId, tenantId))))
      .filter((row) => row.delta < 0).reduce((sum, row) => sum - row.delta, 0);
    assert.equal(await spent(growth.tenantId), 0, 'nothing charged');
    const pro = await storeOn(harness, 'pro', 'pro');
    const job = await createAiJob(pro.ctx, { type: 'generate_3d', input: { productId: 'p' }, creditsCost: 2 });
    assert.notEqual(job.status, 'failed', 'Pro: the job is taken');
    assert.equal(await spent(pro.tenantId), 2, 'and charged its 2 credits — the ledger is read right');
  } finally { await harness.close(); }
});
