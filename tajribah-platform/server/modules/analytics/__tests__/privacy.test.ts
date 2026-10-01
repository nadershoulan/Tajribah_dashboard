/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P4.11 — analytics privacy, held by the code rather than by a policy note:
 *  - what a shop event row can hold is exactly the documented list — no address, no user agent, no
 *    identity has a column to land in;
 *  - raw events go after 90 days, the roll-ups stay, and nothing reads or recomputes past that line;
 *  - who may read what: the screens need `analytics:read`; visit-level detail and the live view are
 *    full analytics; taking figures away needs `analytics:export`.
 * docs/ANALYTICS-PRIVACY.md is the record these tests keep honest.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { getTableColumns } from 'drizzle-orm';
import { analyticsEvents, dailyTenantStats } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import { RETENTION, sweepRetention } from '@/server/modules/admin/retention';
import { RECOMPUTE_DAYS } from '@/server/modules/analytics/rollup';
import { KEPT_DAYS } from '@/server/modules/analytics/sessions';

setLogLevel('error');

test('a shop event row holds exactly the documented fields — nothing that could identify a shopper has a column', () => {
  const columns = Object.values(getTableColumns(analyticsEvents)).map((c) => c.name).sort();
  assert.deepEqual(columns, [
    'ar_supported', 'browser', 'country', 'currency', 'device_type', 'duration_ms', 'event_type', 'id', 'occurred_at', 'os',
    'product_id', 'properties', 'referrer_host', 'region', 'session_id', 'tenant_id', 'value_minor',
  ], 'a new column here is a privacy decision: update docs/ANALYTICS-PRIVACY.md with it, then this list');
  for (const forbidden of ['ip', 'user_agent', 'email', 'phone', 'name', 'url', 'referrer', 'user_id', 'customer_id', 'order_id'])
    assert.ok(!columns.includes(forbidden), forbidden);
  const record = readFileSync(join(process.cwd(), 'docs', 'ANALYTICS-PRIVACY.md'), 'utf8');
  for (const column of columns) assert.ok(record.includes(`\`${column}\``), `docs/ANALYTICS-PRIVACY.md describes \`${column}\``);
});

test('raw events go after 90 days and the roll-ups stay; nothing reads or recomputes past the line', async () => {
  const rule = RETENTION.find((r) => r.key === 'analytics_events')!;
  assert.equal(rule.table, analyticsEvents);
  assert.equal(KEPT_DAYS, 90, 'the explorer offers exactly what is kept');
  assert.ok(RECOMPUTE_DAYS < KEPT_DAYS, 'a roll-up never recomputes a day whose events may be partly gone');
  assert.ok(!RETENTION.some((r) => r.table === dailyTenantStats), 'roll-ups are not swept');

  const harness = await createTestDb();
  try {
    const { tenantId } = await seedTenant(harness, 'oud');
    const now = new Date('2026-10-01T09:00:00Z');
    const at = (days: number) => new Date(now.getTime() - days * 86_400_000);
    await harness.asAdmin(async () => {
      await harness.db.insert(analyticsEvents).values([89.9, 90.1, 200].map((d) => ({ id: uuidv7(), tenantId, eventType: 'product_view', sessionId: `s${d}`, occurredAt: at(d) })) as any);
      await harness.db.insert(dailyTenantStats).values({ tenantId, day: '2026-01-01', views: 7 } as any);
    });
    const removed = await harness.asAdmin(() => sweepRetention(now, harness.db as any));
    assert.equal(removed.analytics_events, 2);
    const left = await harness.asAdmin(() => harness.db.select().from(analyticsEvents));
    assert.deepEqual(left.map((r) => r.sessionId), ['s89.9']);
    assert.equal((await harness.asAdmin(() => harness.db.select().from(dailyTenantStats))).length, 1, 'the daily figure from January stays');
  } finally { await harness.close(); }
});

test('who may read what', () => {
  const can = (role: keyof typeof ROLE_PERMISSIONS, p: string) => (ROLE_PERMISSIONS[role] as readonly string[]).includes(p);
  for (const role of Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]) assert.ok(can(role, 'analytics:read'), `${role} sees the screens`);
  assert.deepEqual((Object.keys(ROLE_PERMISSIONS) as (keyof typeof ROLE_PERMISSIONS)[]).filter((r) => can(r, 'analytics:export')).sort(), ['admin', 'analyst', 'owner']);
  // Visit-level reads assert full analytics before anything else (live.ts, sessions.ts); the tests of
  // each hold the order. Here: that each module states both checks.
  for (const file of ['live.ts', 'sessions.ts']) {
    const code = readFileSync(join(process.cwd(), 'server', 'modules', 'analytics', file), 'utf8');
    assert.match(code, /ctx\.require\('analytics:read'\);\s*\n\s*assertFeature\(await entitlementsOf\(ctx\), 'full_analytics'\);/, file);
  }
});
