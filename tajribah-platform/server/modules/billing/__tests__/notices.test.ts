/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P2.13 — billing notices: invoice issued, payment failed — to owners and admins, in their
 * language, in-app and by email, once each.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { notifications, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { SELLER } from '@/server/core/billing/seller';
import { configureNotify } from '@/server/core/notify/notify';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { issueInvoice } from '@/server/modules/billing/invoices';
import { announceInvoice, announcePaymentFailed } from '@/server/modules/billing/notices';

setLogLevel('error');
const APP = 'https://app.example.test';

async function setup(harness: TestDb) {
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
  const seeded = await seedTenant(harness, 'alpha');
  const adminId = uuidv7();
  const editorId = uuidv7();
  await harness.asAdmin(async () => {
    await harness.db.insert(users).values([
      { id: adminId, email: 'admin@example.test', passwordHash: 'x', fullName: 'Admin', locale: 'en' },
      { id: editorId, email: 'editor@example.test', passwordHash: 'x', fullName: 'Editor' },
    ] as any);
    await harness.db.insert(tenantMemberships).values([
      { id: uuidv7(), tenantId: seeded.tenantId, userId: adminId, role: 'admin', status: 'active' },
      { id: uuidv7(), tenantId: seeded.tenantId, userId: editorId, role: 'editor', status: 'active' },
    ] as any);
  });
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
  return { ...seeded, ctx, adminId, editorId };
}

async function captured<T>(fn: () => Promise<T>): Promise<{ value: T; mail: string }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { return { value: await fn(), mail: lines.join('\n') }; } finally { console.log = original; }
}

test('an issued invoice is announced once: owner and admin, each in their language; not the editor', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, userId, adminId } = await setup(harness);
    const seller = { ...SELLER, vatNumber: '300000000000003' };
    const lines = [{ description: 'Growth — monthly', descriptionAr: 'النمو — شهري', quantity: 1, unitPriceMinor: 29_900 }];
    const { value: invoice, mail } = await captured(() => issueInvoice(ctx, { lines, paid: true, announce: { appUrl: APP } }, seller));

    const rows = await harness.asAdmin(() => harness.db.select().from(notifications).where(eq(notifications.tenantId, tenantId)));
    assert.deepEqual(rows.map((r) => r.userId).sort(), [userId, adminId].sort(), 'owner and admin, not the editor');
    assert.ok(rows.every((r) => r.type === 'invoice.issued' && r.href === `/dashboard/billing/invoices/${invoice.id}`));
    assert.match(mail, /email to alpha@example\.test[\s\S]*فاتورة/, 'the owner’s email in Arabic');
    assert.match(mail, /email to admin@example\.test[\s\S]*Invoice TJ-/, 'the admin’s in English');
    assert.ok(!mail.includes('editor@example.test'));
    assert.ok(mail.includes(`${APP}/dashboard/billing/invoices/${invoice.id}`), 'a link to the invoice');

    const again = await captured(() => announceInvoice(ctx, invoice, APP));
    assert.deepEqual([again.value, again.mail], [false, ''], 'the same invoice is not announced twice');

    const quiet = await captured(() => issueInvoice(ctx, { lines, paid: true }, seller));
    assert.equal(quiet.mail, '', 'no announcement unless the caller asks (the payment path does)');
  } finally { await harness.close(); }
});

test('a failed payment is announced once per payment, with the next attempt', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await setup(harness);
    const payment = { id: uuidv7(), amountMinor: 34_385, currency: 'SAR', retryAt: new Date('2026-10-08T09:00:00Z') };
    const first = await captured(() => announcePaymentFailed(ctx, payment, APP));
    assert.equal(first.value, true);
    assert.match(first.mail, /تعذّر تحصيل/);
    assert.match(first.mail, /try again on 8 Oct 2026/);
    assert.equal((await captured(() => announcePaymentFailed(ctx, payment, APP))).value, false, 'a retried webhook does not mail twice');
    assert.equal((await captured(() => announcePaymentFailed(ctx, { ...payment, id: uuidv7() }, APP))).value, true, 'a new failure is new');
  } finally { await harness.close(); }
});
