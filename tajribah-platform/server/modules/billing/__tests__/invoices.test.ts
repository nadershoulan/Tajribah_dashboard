/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P2.6 — invoices: VAT that adds up, numbers without gaps, documents that never change.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, invoices, tenantMemberships, tenants, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { priceInvoiceLines } from '@/lib/contracts/invoices';
import { SELLER, type Seller } from '@/server/core/billing/seller';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { allocateInvoiceNumber, invoiceOf, invoicesOf, issueInvoice } from '@/server/modules/billing/invoices';

setLogLevel('error');

/** A seller with a VAT number, for the tests only: the real one is not configured yet. */
const TEST_SELLER: Seller = SELLER; // SRO Company's own registration, as supplied (T20)
const GROWTH = [{ description: 'Growth plan — October 2026', descriptionAr: 'باقة النمو — أكتوبر 2026', quantity: 1, unitPriceMinor: 29_900 }];

async function store(harness: TestDb, name: string, role: 'owner' | 'editor' = 'owner') {
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

test('VAT per line, half-up to the halala; the totals add up; impossible lines refused', () => {
  const one = priceInvoiceLines(GROWTH);
  assert.deepEqual([one.subtotalMinor, one.vatMinor, one.totalMinor], [29_900, 4_485, 34_385]);
  const odd = priceInvoiceLines([
    { description: 'a', descriptionAr: null, quantity: 1, unitPriceMinor: 99 },  // 14.85 → 15
    { description: 'b', descriptionAr: null, quantity: 3, unitPriceMinor: 11 },  // 33 → 4.95 → 5
    { description: 'c', descriptionAr: null, quantity: 1, unitPriceMinor: 3 },   // 0.45 → 0
  ]);
  assert.deepEqual(odd.lines.map((l) => l.taxMinor), [15, 5, 0]);
  assert.equal(odd.vatMinor, 20, 'the invoice VAT is the sum of its lines');
  assert.equal(odd.totalMinor, odd.subtotalMinor + odd.vatMinor);
  for (const bad of [[], [{ ...GROWTH[0], quantity: 0 }], [{ ...GROWTH[0], quantity: 1.5 }], [{ ...GROWTH[0], unitPriceMinor: -1 }], [{ ...GROWTH[0], description: ' ' }]]) {
    assert.throws(() => priceInvoiceLines(bad as any));
  }
});

test('the seller: SRO Company as registered; no invoice without a valid VAT number, or dated before the registration took effect', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    assert.deepEqual([SELLER.vatNumber, SELLER.vatEffectiveFrom, SELLER.crNumber, SELLER.address?.postalCode], ['314550511700003', '2026-02-01', '7033242079', '13524']);
    await assert.rejects(() => issueInvoice(ctx, { lines: GROWTH }, { ...SELLER, vatNumber: null }), (e: any) => e.code === 'conflict' && /VAT number/.test(e.message));
    await assert.rejects(() => issueInvoice(ctx, { lines: GROWTH }, { ...SELLER, vatNumber: '123' }), (e: any) => e.code === 'conflict');
    // 31 Jan 20:59 UTC is still 31 Jan in Riyadh: before the registration took effect.
    await assert.rejects(() => issueInvoice(ctx, { lines: GROWTH, issuedAt: new Date('2026-01-31T20:59:00Z') }), (e: any) => e.code === 'conflict' && /2026-02-01/.test(e.message));
    await assert.rejects(() => issueInvoice(ctx, { lines: GROWTH, issuedAt: new Date('2026-06-01T00:00:00Z') }, { ...SELLER, vatEffectiveFrom: null }), (e: any) => e.code === 'conflict');
    assert.equal((await harness.asAdmin(() => harness.db.select().from(invoices))).length, 0, 'nothing written');
  } finally { await harness.close(); }
});

test('an invoice is issued complete: number, both parties as they were, lines, audit — and later edits never reach it', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    await harness.asAdmin(() => harness.db.update(tenants).set({
      name: 'Oud House', nameAr: 'بيت العود', crNumber: '1010123456', vatNumber: '310123456700003', nationalAddress: 'ABCD1234', city: 'Riyadh',
    }).where(eq(tenants.id, tenantId)));

    const issued = await issueInvoice(ctx, { lines: GROWTH, paid: true, issuedAt: new Date('2026-10-05T09:00:00Z') }, TEST_SELLER);
    assert.match(issued.number, /^TJ-2026-[0-9A-F]{8}-000001$/);
    assert.deepEqual([issued.status, issued.kind, issued.totalMinor, issued.vatRateBp], ['paid', 'standard', 34_385, 1500]);
    assert.deepEqual(issued.seller, {
      name: 'SRO Company', nameAr: 'شركة إس أر أو', crNumber: '7033242079', vatNumber: '314550511700003',
      address: '7169 Prince Muhammad Ibn Saad Ibn Abdulaziz Rd, Al Malqa Dist., Riyadh 13524-2369, Saudi Arabia (RRMA7169)',
      addressAr: '7169 طريق الأمير محمد بن سعد بن عبدالعزيز، حي الملقا، الرياض، الرمز البريدي 13524، الرقم الفرعي 2369، المملكة العربية السعودية، العنوان المختصر RRMA7169',
    });
    assert.deepEqual(issued.buyer, { name: 'Oud House', nameAr: 'بيت العود', crNumber: '1010123456', vatNumber: '310123456700003', address: 'ABCD1234, Riyadh', addressAr: null });
    // The first instant of 1 Feb in Riyadh is the first an invoice can carry VAT.
    await issueInvoice(ctx, { lines: GROWTH, issuedAt: new Date('2026-01-31T21:00:00Z') });
    assert.equal(issued.lines[0].descriptionAr, 'باقة النمو — أكتوبر 2026');
    assert.deepEqual(issued.zatca, { status: null, qr: null }, 'ZATCA fields are the provider’s, never invented');

    // The store renames itself and changes its VAT number; the seller's details change too.
    await harness.asAdmin(() => harness.db.update(tenants).set({ name: 'Renamed', vatNumber: null }).where(eq(tenants.id, tenantId)));
    const later = await invoiceOf(ctx, issued.id);
    assert.deepEqual(later, issued, 'an issued invoice reads exactly as it did');

    const second = await issueInvoice(ctx, { lines: GROWTH, issuedAt: new Date('2026-11-05T09:00:00Z') }, TEST_SELLER);
    assert.match(second.number, /-000003$/);
    assert.equal(second.kind, 'simplified', 'no buyer VAT number: a simplified tax invoice');
    assert.equal(second.status, 'issued');

    const audit = await harness.asAdmin(() => harness.db.select().from(auditLogs));
    assert.equal(audit.filter((r) => r.resourceType === 'invoice' && r.action === 'create').length, 3);
  } finally { await harness.close(); }
});

test('numbers have no gaps: concurrent issues take 1…n, and a rolled-back issue gives its number back', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const at = new Date('2026-06-01T09:00:00Z');

    // A transaction that took a number and then failed: the number is not spent.
    await assert.rejects(() => withTenant(tenantId, async (db) => {
      assert.equal(await allocateInvoiceNumber(db, 2026), 1);
      throw new Error('payment record failed');
    }), /payment record failed/);

    const issued = await Promise.all(Array.from({ length: 10 }, () => issueInvoice(ctx, { lines: GROWTH, issuedAt: at }, TEST_SELLER)));
    const numbers = issued.map((i) => Number(i.number.slice(-6))).sort((a, b) => a - b);
    assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  } finally { await harness.close(); }
});

test('each store has its own sequence, restarting each Riyadh year; another store’s invoice is not found', async () => {
  const harness = await createTestDb();
  try {
    const alpha = await store(harness, 'alpha');
    const bravo = await store(harness, 'bravo');
    // 31 Dec 2026, 23:30 in Riyadh — still 2026. Half an hour later it is 2027 there (still 2026 in UTC).
    const lastOf2026 = await issueInvoice(alpha.ctx, { lines: GROWTH, issuedAt: new Date('2026-12-31T20:30:00Z') }, TEST_SELLER);
    const firstOf2027 = await issueInvoice(alpha.ctx, { lines: GROWTH, issuedAt: new Date('2026-12-31T21:30:00Z') }, TEST_SELLER);
    assert.match(lastOf2026.number, /^TJ-2026-.*-000001$/);
    assert.match(firstOf2027.number, /^TJ-2027-.*-000001$/, 'the Riyadh year, not the UTC one');

    const theirs = await issueInvoice(bravo.ctx, { lines: GROWTH, issuedAt: new Date('2026-12-31T20:30:00Z') }, TEST_SELLER);
    assert.match(theirs.number, /-000001$/, 'bravo’s own sequence');
    assert.notEqual(theirs.number, lastOf2026.number, 'numbers stay unique across stores');

    assert.equal(await invoiceOf(alpha.ctx, theirs.id), null);
    assert.deepEqual((await invoicesOf(alpha.ctx)).map((i) => i.number), [firstOf2027.number, lastOf2026.number], 'own invoices, newest first');
  } finally { await harness.close(); }
});

test('only billing roles read invoices, and only the platform (or an owner) issues them', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha', 'editor');
    await assert.rejects(() => invoicesOf(ctx), (e: any) => e.code === 'forbidden');
    await assert.rejects(() => issueInvoice(ctx, { lines: GROWTH }, TEST_SELLER), (e: any) => e.code === 'forbidden');
  } finally { await harness.close(); }
});
