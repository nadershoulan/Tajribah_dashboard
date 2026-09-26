/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A7 — subscriptions and invoices across stores, for staff: filters, counts, totals over the
 * filter (issued and paid only), the Riyadh month, and the invoice as its store sees it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { creditLedger, invoices, subscriptions, tenants } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, seededPlanId, type TestDb } from '@/server/testing/harness';
import type { StaffContext } from '@/server/modules/admin/access';
import { invoiceForStaff, listInvoices, listSubscriptions, riyadhMonth } from '@/server/modules/admin/billing';

setLogLevel('error');
const STAFF = (id: string): StaffContext => ({ userId: id, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'r' });

const invoice = (harness: TestDb, tenantId: string, number: string, status: string, totalMinor: number, issuedAt: string | null) =>
  harness.asAdmin(async () => {
    const id = uuidv7();
    await harness.db.insert(invoices).values({
      id, tenantId, invoiceNumber: number, status, subtotalMinor: Math.round(totalMinor / 1.15), vatMinor: totalMinor - Math.round(totalMinor / 1.15), totalMinor,
      issuedAt: issuedAt ? new Date(issuedAt) : null,
    } as any);
    return id;
  });

test('subscriptions: newest first, status / plan / cycle filters, counts per status, list price for the cycle, paging, no deleted stores', async () => {
  const harness = await createTestDb();
  try {
    const [a, b, c, d] = [await seedTenant(harness, 'alpha'), await seedTenant(harness, 'bravo'), await seedTenant(harness, 'charlie'), await seedTenant(harness, 'delta')];
    const growth = await seededPlanId(harness, 'growth');
    const pro = await seededPlanId(harness, 'pro');
    const now = new Date();
    const sub = (tenantId: string, planId: string, status: string, billingCycle = 'monthly') =>
      harness.asAdmin(() => harness.db.insert(subscriptions).values({ id: uuidv7(), tenantId, planId, status, billingCycle, currentPeriodStart: now, currentPeriodEnd: now } as any));
    await sub(a.tenantId, growth, 'active');
    await sub(b.tenantId, growth, 'past_due', 'annual');
    await sub(c.tenantId, pro, 'active');
    await sub(d.tenantId, pro, 'cancelled');
    await harness.asAdmin(() => harness.db.update(tenants).set({ deletedAt: now }).where(eq(tenants.id, d.tenantId)));

    const all = await listSubscriptions();
    assert.deepEqual(all.subscriptions.map((s) => s.store.id), [c.tenantId, b.tenantId, a.tenantId], 'newest first, the deleted store absent');
    assert.deepEqual(all.byStatus, { active: 2, past_due: 1 });
    const annual = all.subscriptions.find((s) => s.store.id === b.tenantId)!;
    assert.deepEqual([annual.plan, annual.cycle, annual.listPriceMinor], ['growth', 'annual', 299000], 'the annual list price');
    assert.deepEqual((await listSubscriptions({ status: 'active' })).subscriptions.map((s) => s.store.id), [c.tenantId, a.tenantId]);
    const growthOnly = await listSubscriptions({ plan: 'growth' });
    assert.deepEqual(growthOnly.subscriptions.map((s) => s.store.id), [b.tenantId, a.tenantId]);
    assert.deepEqual(growthOnly.byStatus, { active: 1, past_due: 1 }, 'the counts follow the plan filter');
    assert.deepEqual((await listSubscriptions({ status: 'active', plan: 'growth' })).byStatus, { active: 1, past_due: 1 }, 'but not the status filter (they are its tabs)');
    assert.deepEqual((await listSubscriptions({ cycle: 'annual' })).subscriptions.map((s) => s.store.id), [b.tenantId]);
    const first = await listSubscriptions({ limit: 2 });
    assert.deepEqual((await listSubscriptions({ limit: 2, before: first.next! })).subscriptions.map((s) => s.store.id), [a.tenantId]);
  } finally { await harness.close(); }
});

test('invoices: filters, the Riyadh month, totals over the filter counting issued and paid only, number search; one invoice as the store sees it', async () => {
  const harness = await createTestDb();
  try {
    const a = await seedTenant(harness, 'alpha');
    const b = await seedTenant(harness, 'bravo');
    const gone = await seedTenant(harness, 'charlie');
    // 30 Sep 21:30 UTC is 1 Oct 00:30 in Riyadh: an October invoice.
    const october = await invoice(harness, a.tenantId, 'TJ-2026-AAAAAAAA-000002', 'paid', 11500, '2026-09-30T21:30:00Z');
    await invoice(harness, a.tenantId, 'TJ-2026-AAAAAAAA-000001', 'issued', 23000, '2026-09-30T20:30:00Z');
    await invoice(harness, b.tenantId, 'TJ-2026-BBBBBBBB-000001', 'void', 99900, '2026-09-10T10:00:00Z');
    await invoice(harness, b.tenantId, 'TJ-2026-BBBBBBBB-000002', 'draft', 5000, null);
    await invoice(harness, gone.tenantId, 'TJ-2026-CCCCCCCC-000001', 'paid', 77700, '2026-09-12T10:00:00Z');
    await harness.asAdmin(() => harness.db.update(tenants).set({ deletedAt: new Date() }).where(eq(tenants.id, gone.tenantId)));

    const all = await listInvoices();
    assert.equal(all.invoices.length, 4, 'the deleted store’s invoice is absent');
    assert.deepEqual(all.totals, { count: 2, totalMinor: 34500, vatMinor: all.invoices.filter((i) => i.status === 'issued' || i.status === 'paid').reduce((s, i) => s + i.vatMinor, 0) }, 'void and draft do not count');
    const sept = await listInvoices({ month: '2026-09' });
    assert.deepEqual(sept.invoices.map((i) => i.number).sort(), ['TJ-2026-AAAAAAAA-000001', 'TJ-2026-BBBBBBBB-000001'], '20:30 UTC on the 30th is still September in Riyadh');
    assert.deepEqual(sept.totals.totalMinor, 23000);
    assert.deepEqual((await listInvoices({ month: '2026-10' })).invoices.map((i) => i.id), [october]);
    assert.deepEqual((await listInvoices({ status: 'void' })).invoices.map((i) => i.number), ['TJ-2026-BBBBBBBB-000001']);
    assert.equal((await listInvoices({ status: 'void' })).totals.count, 0);
    assert.deepEqual((await listInvoices({ q: 'bbbbbbbb-000002' })).invoices.map((i) => i.status), ['draft'], 'number search, any case');
    assert.deepEqual((await listInvoices({ q: '%' })).invoices, [], '% is a character');
    await assert.rejects(() => listInvoices({ month: '2026-13' }), (e: any) => e.code === 'validation_failed');
    assert.deepEqual(riyadhMonth('2026-01')!.map((d) => d.toISOString()), ['2025-12-31T21:00:00.000Z', '2026-01-31T21:00:00.000Z']);

    const opened = await invoiceForStaff(STAFF(a.userId), october);
    assert.equal(opened.store.id, a.tenantId);
    assert.equal(opened.invoice.number, 'TJ-2026-AAAAAAAA-000002');
    assert.equal(opened.invoice.totalMinor, 11500);
    assert.equal((await harness.asAdmin(() => harness.db.select().from(creditLedger))).length, 0, 'opening an invoice writes nothing');
    await assert.rejects(() => invoiceForStaff(STAFF(a.userId), uuidv7()), (e: any) => e.code === 'not_found');
  } finally { await harness.close(); }
});
