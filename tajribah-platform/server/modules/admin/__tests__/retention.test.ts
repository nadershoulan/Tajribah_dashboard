/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A14 — retention under T22: each rule removes exactly what has passed its period, on either
 * side of the line; invoices and the ledger are never touched; deleted stores are only listed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { analyticsEvents, auditLogs, creditLedger, invoices, jobs, notifications, sessions, staffAudit, tenants, users, verificationTokens, webhookEvents } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import { retentionState, sweepRetention } from '@/server/modules/admin/retention';

setLogLevel('error');
const DAY = 86_400_000;

test('the sweep removes exactly what is past its period, keeps the rest, and never touches invoices or the ledger', async () => {
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const gone = await seedTenant(harness, 'bravo');
    const now = new Date('2026-09-27T12:00:00Z');
    const ago = (days: number) => new Date(now.getTime() - days * DAY - 60_000); // a minute past the line
    const within = (days: number) => new Date(now.getTime() - days * DAY + 60_000); // a minute before it
    const t = store.tenantId;
    await harness.asAdmin(async () => {
      const db = harness.db;
      await db.insert(analyticsEvents).values([
        { tenantId: t, eventType: 'product_view', sessionId: 's', occurredAt: ago(90) }, { tenantId: t, eventType: 'product_view', sessionId: 's', occurredAt: within(90) },
      ] as any);
      await db.insert(sessions).values([
        { userId: store.userId, expiresAt: now, revokedAt: ago(90) }, { userId: store.userId, expiresAt: now, revokedAt: within(90) },
        { userId: store.userId, expiresAt: ago(90) }, { userId: store.userId, expiresAt: new Date(now.getTime() + DAY) },
      ] as any);
      await db.insert(verificationTokens).values([
        { userId: store.userId, purpose: 'email_verify', tokenHash: 'a', expiresAt: ago(7) }, { userId: store.userId, purpose: 'email_verify', tokenHash: 'b', expiresAt: within(7) },
      ] as any);
      await db.insert(notifications).values([
        { tenantId: t, type: 'x', titleAr: 'ع', titleEn: 'T', readAt: ago(180) }, { tenantId: t, type: 'x', titleAr: 'ع', titleEn: 'T', readAt: within(180) },
        { tenantId: t, type: 'x', titleAr: 'ع', titleEn: 'T', createdAt: ago(365) }, { tenantId: t, type: 'x', titleAr: 'ع', titleEn: 'T', createdAt: within(365) },
      ] as any);
      const hook = (status: string, createdAt: Date) => ({ tenantId: t, provider: 'salla', providerEventId: uuidv7(), topic: 'x', signatureValid: true, status, createdAt });
      await db.insert(webhookEvents).values([hook('processed', ago(30)), hook('processed', within(30)), hook('failed', ago(30)), hook('failed', ago(90)), hook('received', ago(400))] as any);
      await db.insert(jobs).values([
        { queue: 'q', state: 'done', finishedAt: ago(30) }, { queue: 'q', state: 'done', finishedAt: within(30) },
        { queue: 'q', state: 'dead', finishedAt: ago(30) }, { queue: 'q', state: 'dead', finishedAt: ago(90) }, { queue: 'q', state: 'queued' },
      ] as any);
      await db.insert(auditLogs).values([
        { tenantId: t, action: 'x', resourceType: 'y', createdAt: ago(3 * 365) }, { tenantId: t, action: 'x', resourceType: 'y', createdAt: within(3 * 365) },
      ] as any);
      await db.insert(staffAudit).values([
        { staffUserId: store.userId, action: 'x', targetType: 'y', createdAt: ago(5 * 365) }, { staffUserId: store.userId, action: 'x', targetType: 'y', createdAt: within(5 * 365) },
      ] as any);
      await db.insert(invoices).values({ tenantId: t, invoiceNumber: 'TJ-OLD', status: 'paid', subtotalMinor: 1, vatMinor: 0, totalMinor: 1, createdAt: ago(3000) } as any);
      await db.insert(creditLedger).values({ tenantId: t, delta: 5, balanceAfter: 5, reason: 'purchase', referenceType: 'payment', referenceId: uuidv7(), createdAt: ago(3000) } as any);
      await db.update(tenants).set({ deletedAt: ago(90) }).where(eq(tenants.id, gone.tenantId));
    });

    const before = await retentionState(now);
    const due = Object.fromEntries(before.rules.map((r) => [r.key, r.due]));
    assert.deepEqual(due, { analytics_events: 1, sessions: 2, verification_tokens: 1, notifications: 2, webhook_events: 2, jobs: 2, audit_logs: 1, staff_audit: 1 });
    assert.equal(before.deletedStoresForReview, 1);

    assert.deepEqual(await sweepRetention(now), due, 'removes what the console said it would');
    const left = async (table: any) => (await harness.asAdmin(() => harness.db.select().from(table))).length;
    assert.deepEqual(
      [await left(analyticsEvents), await left(verificationTokens), await left(notifications), await left(webhookEvents), await left(jobs), await left(auditLogs), await left(staffAudit)],
      [1, 1, 2, 3, 3, 1, 1],
    );
    assert.equal((await harness.asAdmin(() => harness.db.select().from(sessions).where(eq(sessions.userId, store.userId)))).length, 2);
    assert.deepEqual([await left(invoices), await left(creditLedger)], [1, 1], 'never swept');
    assert.equal((await harness.asAdmin(() => harness.db.select().from(tenants).where(eq(tenants.id, gone.tenantId)))).length, 1, 'a deleted store is listed, not purged');
    assert.deepEqual(Object.values(await sweepRetention(now)).reduce((a, b) => a + b, 0), 0, 'a second sweep finds nothing');
    void users;
  } finally { await harness.close(); }
});
