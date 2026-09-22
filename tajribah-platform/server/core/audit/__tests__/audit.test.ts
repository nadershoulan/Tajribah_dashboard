/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { auditLogs, products } from '@/db/schema';
import { buildTenantContext } from '@/server/core/tenancy/context';
import {
  auditedDelete, auditedInsert, auditedUpdate, diff, recentActivity,
} from '@/server/core/audit/audit';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { withTenant } from '@/server/core/tenancy/rls';
import { sql } from 'drizzle-orm';
import { setLogLevel } from '@/server/core/observability/log';

setLogLevel('error');

async function contextFor(harness: TestDb, name: string, requestId = `req-${name}`) {
  const seeded = await seedTenant(harness, name);
  const ctx = await buildTenantContext({
    actor: { userId: seeded.userId, email: seeded.email, isStaff: false },
    tenantId: seeded.tenantId,
    requestId,
  });
  return { ...seeded, ctx };
}

/** All audit rows, read as the superuser so nothing can hide one from the assertion. */
const allAuditRows = (harness: TestDb) => harness.asAdmin(() => harness.db.select().from(auditLogs));

test('an update writes exactly one audit row with a before/after diff', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, userId } = await contextFor(harness, 'alpha', 'req-123');
    const product = await auditedInsert(ctx, products, { name: 'Oyster 41' }, { resourceType: 'product' });
    const before = (await allAuditRows(harness)).length;

    await auditedUpdate(ctx, products, String(product.id), { name: 'Oyster 41 — steel' }, { resourceType: 'product' });

    const rows = await allAuditRows(harness);
    assert.equal(rows.length - before, 1, 'exactly one row per update');
    const row = rows.find((r) => r.action === 'update')!;
    assert.equal(row.tenantId, ctx.tenantId);
    assert.equal(row.actorUserId, userId);
    assert.equal(row.requestId, 'req-123');
    assert.equal(row.resourceType, 'product');
    assert.equal(row.resourceId, product.id);
    assert.deepEqual(row.changes, {
      before: { name: 'Oyster 41' },
      after: { name: 'Oyster 41 — steel' },
    }, 'only the field that changed, and not updated_at');
  } finally { await harness.close(); }
});

test('an update that changes nothing writes nothing', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await contextFor(harness, 'alpha');
    const product = await auditedInsert(ctx, products, { name: 'Same' }, { resourceType: 'product' });
    const before = (await allAuditRows(harness)).length;
    await auditedUpdate(ctx, products, String(product.id), { name: 'Same' }, { resourceType: 'product' });
    assert.equal((await allAuditRows(harness)).length, before);
  } finally { await harness.close(); }
});

test('create and delete are recorded with the row they made or removed', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await contextFor(harness, 'alpha');
    const product = await auditedInsert(ctx, products, { name: 'Gone soon' }, { resourceType: 'product' });
    await auditedDelete(ctx, products, String(product.id), { resourceType: 'product' });

    const rows = await allAuditRows(harness);
    const created = rows.find((r) => r.action === 'create')!;
    const deleted = rows.find((r) => r.action === 'delete')!;
    assert.equal((created.changes as any).after.name, 'Gone soon');
    assert.deepEqual((created.changes as any).before, {});
    assert.equal((deleted.changes as any).before.name, 'Gone soon');
    assert.equal(await harness.asAdmin(() => harness.db.select().from(products)).then((r) => r.length), 0);
  } finally { await harness.close(); }
});

test('if the audit row cannot be written, the change is rolled back', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await contextFor(harness, 'alpha');
    const product = await auditedInsert(ctx, products, { name: 'Original' }, { resourceType: 'product' });

    // resource_type is NOT NULL: the audit insert fails inside the same transaction.
    await assert.rejects(() => auditedUpdate(ctx, products, String(product.id), { name: 'Changed' }, { resourceType: null as never }));

    const [stored] = await harness.asAdmin(() => harness.db.select().from(products));
    assert.equal(stored.name, 'Original', 'a change with no audit row must not survive');
  } finally { await harness.close(); }
});

test('another tenant cannot update, delete or see the audit trail', async () => {
  const harness = await createTestDb();
  try {
    const a = await contextFor(harness, 'alpha');
    const b = await contextFor(harness, 'bravo');
    const product = await auditedInsert(a.ctx, products, { name: 'A only' }, { resourceType: 'product' });

    await assert.rejects(() => auditedUpdate(b.ctx, products, String(product.id), { name: 'taken' }, { resourceType: 'product' }), /not.found|not_found/i);
    await assert.rejects(() => auditedDelete(b.ctx, products, String(product.id), { resourceType: 'product' }), /not.found|not_found/i);

    assert.equal((await recentActivity(a.ctx)).length, 1);
    assert.equal((await recentActivity(b.ctx)).length, 0, "B's activity list must not show A's rows");
    assert.ok((await allAuditRows(harness)).every((r) => r.tenantId === a.ctx.tenantId), 'refused attempts write no audit rows');
  } finally { await harness.close(); }
});

test('the audit trail is append-only for the application: its own rows cannot be edited or erased', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await contextFor(harness, 'alpha');
    await auditedInsert(ctx, products, { name: 'Evidence' }, { resourceType: 'product' });
    for (const attempt of [
      (db: any) => db.execute(sql`update audit_logs set action = 'nothing-happened'`),
      (db: any) => db.execute(sql`delete from audit_logs`),
    ]) {
      // Raw SQL on the transaction under TenantDb, on purpose: the guarantee is the database's,
      // not the helper's, so it has to hold for code that bypasses the helpers too.
      await assert.rejects(
        () => withTenant(ctx.tenantId, (tdb) => attempt((tdb as any).db)),
        // Drizzle wraps the driver error; Postgres's own reason is the cause.
        (error: any) => /permission denied/.test(`${error?.message} ${error?.cause?.message}`),
        'even inside its own tenant, the app role must not rewrite history',
      );
    }
    const rows = await allAuditRows(harness);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].action, 'create');
  } finally { await harness.close(); }
});

test('secrets never reach the diff', () => {
  const changes = diff(
    { name: 'a', passwordHash: 'x', accessToken: 'y', apiKeyHash: 'z', updatedAt: new Date(1) },
    { name: 'b', passwordHash: 'x2', accessToken: 'y2', apiKeyHash: 'z2', updatedAt: new Date(2) },
  );
  assert.deepEqual(changes, { before: { name: 'a' }, after: { name: 'b' } });
});

/**
 * The structural half of "every mutating action is audited": a service that writes through
 * `ctx.db` directly bypasses the audit trail, so it fails here with its file and line.
 */
test('no module service writes tenant data around the audit helpers', () => {
  const root = join(process.cwd(), 'server', 'modules');
  const offenders: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) { if (entry !== '__tests__') walk(full); continue; }
      if (!entry.endsWith('.ts')) continue;
      readFileSync(full, 'utf8').split('\n').forEach((line, i) => {
        if (/\bctx\.db\.(insert|update|updateById|delete|deleteById)\(/.test(line)) {
          offenders.push(`${relative(process.cwd(), full)}:${i + 1}  ${line.trim()}`);
        }
      });
    }
  };
  walk(root);
  assert.deepEqual(offenders, [], 'Use auditedInsert/auditedUpdate/auditedDelete (server/core/audit):\n' + offenders.join('\n'));
});
