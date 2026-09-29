/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P7 database performance — every list a screen or a sweep reads per request has an index that
 * serves both its filter and its order: no full-table scan, no sort of everything the store (or
 * connection) ever had. Each query is written as its call site builds it (named beside it), and
 * asked of the planner with sequential scans and sorts priced out — so a plan that still needs
 * one means no index can do the work. An empty table gives the same answer as a large one here:
 * the question is whether an index *can* serve the query, not whether the planner would pick it
 * today.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq, sql } from 'drizzle-orm';
import { storeConnections } from '@/db/schema';
import { ProductListQuery } from '@/lib/contracts/products';
import { uuidv7 } from '@/lib/ids';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import { listAiJobs } from '@/server/modules/ai-jobs/lifecycle';
import { creditSummary } from '@/server/modules/billing/credits';
import { healthFactsFor } from '@/server/modules/connections/health';
import { dashboardSummary } from '@/server/modules/dashboard/service';
import { myNotifications } from '@/server/modules/notifications/service';
import { listProducts } from '@/server/modules/products/service';
import { latestSync } from '@/server/modules/sync/service';
import { webhookHealth } from '@/server/modules/webhooks/service';

const T = `'01a0ec9b-33c6-7d21-a5f9-e8de25520f15'`; // a store
const U = `'01a0ec9b-33c6-7d21-a5f9-e8de25520f16'`; // a person
const C = `'01a0ec9b-33c6-7d21-a5f9-e8de25520f17'`; // a connection
const J = `'01a0ec9b-33c6-7d21-a5f9-e8de25520f18'`; // a cursor / job id

/** [call site, SQL, the index that must serve it — `a|b` when either serves it equally] */
const HOT: [string, string, string][] = [
  ['products/service.ts listProducts — the catalogue, newest first',
    `select * from products where tenant_id = ${T} and deleted_at is null order by id desc limit 51`, 'products_tenant_id_idx'],
  ['products/service.ts listProducts — the next page (cursor)',
    `select * from products where tenant_id = ${T} and deleted_at is null and id < ${J} order by id desc limit 51`, 'products_tenant_id_idx'],
  ['ai-jobs/lifecycle.ts listAiJobs — the jobs screen',
    `select * from ai_jobs where tenant_id = ${T} order by id desc limit 50`, 'ai_jobs_tenant_id_idx'],
  ['ai-jobs/guardrails.ts spentTodayCents — before every AI job',
    `select coalesce(sum(actual_cost_cents), 0) from ai_jobs where created_at >= now() - interval '1 day'`, 'ai_jobs_created_idx'],
  ['notifications/service.ts myNotifications — the bell',
    `select * from notifications where tenant_id = ${T} and user_id = ${U} order by created_at desc limit 30`, 'notifications_tenant_user_time_idx'],
  ['notifications/service.ts myNotifications — the unread count',
    `select count(*) from notifications where tenant_id = ${T} and user_id = ${U} and read_at is null`, 'notifications_tenant_user_idx|notifications_tenant_user_time_idx'],
  ['sync/service.ts — a connection\'s latest sync',
    `select * from sync_jobs where tenant_id = ${T} and connection_id = ${C} order by id desc limit 1`, 'sync_jobs_connection_idx'],
  ['connections/health.ts — the last five finished syncs',
    `select * from sync_jobs where tenant_id = ${T} and connection_id = ${C} and status in ('done', 'failed') order by id desc limit 5`, 'sync_jobs_connection_idx'],
  ['webhooks/service.ts — a connection\'s latest delivery',
    `select * from webhook_events where tenant_id = ${T} and connection_id = ${C} order by created_at desc limit 1`, 'webhook_events_connection_idx'],
  ['connections/health.ts — the oldest delivery still waiting',
    `select * from webhook_events where tenant_id = ${T} and connection_id = ${C} and status = 'received' order by created_at asc limit 1`, 'webhook_events_connection_idx'],
  ['connections/health.ts — the last day\'s deliveries',
    `select count(*) from webhook_events where tenant_id = ${T} and connection_id = ${C} and created_at >= now() - interval '1 day'`, 'webhook_events_connection_idx'],
  ['dashboard/service.ts — the activity feed',
    `select * from audit_logs where tenant_id = ${T} order by created_at desc limit 60`, 'audit_tenant_time_idx'],
  ['billing/credits.ts — the balance (latest ledger row)',
    `select * from credit_ledger where tenant_id = ${T} order by created_at desc limit 1`, 'credit_ledger_tenant_idx'],
];

/** Every node of a JSON plan, flattened. */
function nodes(plan: any): any[] {
  return [plan, ...(plan.Plans ?? []).flatMap(nodes)];
}

test('every hot list is served by an index — no full scan, no sort', async () => {
  const harness = await createTestDb();
  try {
    await harness.asAdmin(async () => {
      await harness.db.execute(sql`set enable_seqscan = off`);
      await harness.db.execute(sql`set enable_sort = off`);
      await harness.db.execute(sql`set enable_bitmapscan = off`);
    });
    const problems: string[] = [];
    for (const [site, query, index] of HOT) {
      const result: any = await harness.asAdmin(() => harness.db.execute(sql.raw(`explain (format json) ${query}`)));
      const rows = result.rows ?? result;
      const raw = rows[0]['QUERY PLAN'];
      const plan = (typeof raw === 'string' ? JSON.parse(raw) : raw)[0].Plan;
      const all = nodes(plan);
      const kinds = all.map((n) => n['Node Type']);
      const used = all.map((n) => n['Index Name']).filter(Boolean);
      if (kinds.includes('Seq Scan') || kinds.includes('Sort') || !index.split('|').some((name) => used.includes(name))) {
        problems.push(`${site}: ${kinds.join(' > ')} ${used.length ? `(${used.join(', ')})` : ''} — wanted ${index}`);
      }
    }
    assert.deepEqual(problems, []);
  } finally { await harness.close(); }
});

/**
 * The same question of the code itself: the real call sites run with every statement recorded,
 * and each read of a hot table is explained exactly as sent. A query changed in the code — a new
 * order, a dropped filter — cannot drift away from its index unnoticed.
 */
const HOT_TABLES = ['products', 'ai_jobs', 'notifications', 'sync_jobs', 'webhook_events', 'audit_logs', 'credit_ledger'];
const PRICED_OUT = 'SET enable_seqscan = off; SET enable_sort = off; SET enable_bitmapscan = off;';

test('the code\'s own reads of the hot tables are served by indexes — no full scan, no sort', async () => {
  const seen: { text: string; params: unknown[] }[] = [];
  let recording = false;
  const harness = await createTestDb({ observe: (text, params) => { if (recording) seen.push({ text, params }); } });
  try {
    const seeded = await seedTenant(harness, 'alpha');
    const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
    const connectionId = uuidv7();
    await harness.asAdmin(() => harness.db.insert(storeConnections).values({ id: connectionId, tenantId: seeded.tenantId, provider: 'salla', externalStoreId: 's-1' } as any));
    const [connection] = await harness.asAdmin(() => harness.db.select().from(storeConnections).where(eq(storeConnections.id, connectionId)));

    recording = true;
    await listProducts(ctx, ProductListQuery.parse({}));
    await listProducts(ctx, ProductListQuery.parse({ cursor: uuidv7() }));
    await listAiJobs(ctx);
    await listAiJobs(ctx, { active: true });
    await myNotifications(ctx);
    await latestSync(ctx, connectionId);
    await webhookHealth(ctx, connectionId);
    await withTenant(seeded.tenantId, (db) => healthFactsFor(db, connection!, new Date()));
    await creditSummary(ctx);
    await dashboardSummary(ctx);
    recording = false;

    const hot = seen.filter(({ text }) => /^\s*select\b/i.test(text) && HOT_TABLES.some((t) => new RegExp(`from "${t}"`).test(text)));
    for (const table of HOT_TABLES) assert.ok(hot.some(({ text }) => text.includes(`from "${table}"`)), `the call sites read ${table}`);
    const problems: string[] = [];
    for (const { text, params } of hot) {
      const all = nodes(await harness.explain(text, params, PRICED_OUT));
      const kinds = all.map((n) => n['Node Type']);
      if (kinds.includes('Seq Scan') || kinds.includes('Sort')) problems.push(`${kinds.join(' > ')} — ${text.slice(0, 160)}`);
    }
    assert.deepEqual(problems, []);
  } finally { await harness.close(); }
});
