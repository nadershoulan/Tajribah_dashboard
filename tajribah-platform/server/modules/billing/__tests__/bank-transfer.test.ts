/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T129 — paying by bank transfer, end to end on a real Postgres: staff set the methods and accounts; a store sends a
 * request priced by the server with its receipt judged by its bytes; staff approve (plan on, paid invoice, payment —
 * one transaction), decline, or ask for more; renewals extend, a change of plan carries the paid days; a coupon is
 * held and given back; one store never sees another's; plans paid by transfer are reminded, fall past due, and
 * become read-only after the grace days.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq, sql } from 'drizzle-orm';
import { appDb, unsafeAdminDb } from '@/db/client';
import {
  auditLogs, bankAccounts, bankTransferEvents, bankTransferRequests, couponRedemptions, coupons, invoices, notifications, payments,
  paymentMethodSettings, staffAudit, subscriptions, tenants, users,
} from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { addMonths, REFERENCE_PATTERN } from '@/lib/contracts/bank-transfer';
import { configureNotify } from '@/server/core/notify/notify';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { MemoryStorage, setStorage, storage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import type { StaffContext } from '@/server/modules/admin/access';
import { approveTransfer, listTransfers, noteTransfer, rejectTransfer, requestTransferInfo, transferDetail } from '@/server/modules/admin/bank-transfers';
import {
  cancelTransfer, receiptBody, resubmitTransfer, startReceiptUpload, submitTransfer, transfersOf, type SubmitTransferInput,
} from '@/server/modules/billing/bank-transfer';
import {
  checkoutOptions, createBankAccount, deleteBankAccount, paymentSettingsForStaff, updateBankAccount, updatePaymentMethod,
} from '@/server/modules/billing/payment-methods';
import { billingSummary } from '@/server/modules/billing/summary';
import { sweepTransferRenewals } from '@/server/modules/billing/transfer-renewals';

setLogLevel('error');
const APP = 'https://app.example.test';
const DAY = 86_400_000;
const IBAN = 'SA0380000000608010167519'; // the ISO registry's Saudi example
const IBAN_2 = 'SA4420000001234567891234';
const PNG = (size = 1200) => { const b = new Uint8Array(size); b.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); return b; };
const ACCOUNT = { bankName: 'Al Rajhi Bank', bankNameAr: 'مصرف الراجحي', accountHolder: 'شركة إس أر أو', accountNumber: '608010167519', iban: IBAN };

async function captured<T>(fn: () => Promise<T>): Promise<{ value: T; mail: string }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { return { value: await fn(), mail: lines.join('\n') }; } finally { console.log = original; }
}

async function store(harness: TestDb, name: string, status: 'trial' | 'active' | 'suspended' = 'trial') {
  const seeded = await seedTenant(harness, name);
  await harness.asAdmin(() => harness.db.update(tenants).set({ status }).where(eq(tenants.id, seeded.tenantId)));
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx };
}

async function setup(harness: TestDb) {
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
  setStorage(new MemoryStorage());
  setRateLimiter(new MemoryRateLimiter());
  const staffId = uuidv7();
  await harness.asAdmin(() => harness.db.insert(users).values({ id: staffId, email: 'staff@tajribah.test', passwordHash: 'x', fullName: 'Staff', isStaff: true, totpEnabled: true, locale: 'en' } as any));
  const staff: StaffContext = { userId: staffId, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'r' };
  const account = await createBankAccount(staff, { ...ACCOUNT, reason: 'our main account' });
  const alpha = await store(harness, 'alpha');
  return { staff, account, alpha };
}

async function receipt(ctx: any, bytes: Uint8Array = PNG()): Promise<string> {
  const up = await startReceiptUpload(ctx, { filename: 'r.png', contentType: 'image/png', sizeBytes: bytes.length });
  await storage().put(up.key, bytes.slice().buffer as ArrayBuffer);
  return up.key;
}

const order = (accountId: string, key: string | null, extra: Partial<SubmitTransferInput> = {}): SubmitTransferInput =>
  ({ plan: 'growth', cycle: 'monthly', bankAccountId: accountId, senderName: 'Nader Shoulan', receiptKey: key, receiptName: 'receipt.png', ...extra });

const rows = <T>(harness: TestDb, fn: () => Promise<T>) => harness.asAdmin(fn);

test('staff: a method whose gateway is not wired cannot be switched on; bank transfer is offered only with an active account', async () => {
  const harness = await createTestDb();
  try {
    configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
    const staffId = uuidv7();
    await harness.asAdmin(() => harness.db.insert(users).values({ id: staffId, email: 's@tajribah.test', passwordHash: 'x', fullName: 'S', isStaff: true } as any));
    const staff: StaffContext = { userId: staffId, email: 's@tajribah.test', fullName: 'S', requestId: 'r' };
    const seeded = (await paymentSettingsForStaff()).methods;
    assert.deepEqual(seeded.map((m) => m.key), ['bank_transfer', 'mada', 'card', 'applepay', 'stcpay', 'tamara', 'tabby'], 'every method listed, in order');
    assert.deepEqual(seeded.filter((m) => m.enabled).map((m) => m.key), ['bank_transfer'], 'bank transfer starts on (migration 0047)');
    assert.deepEqual((await checkoutOptions()).methods, [], 'no account yet: nothing to transfer to, so nothing offered');

    await assert.rejects(() => updatePaymentMethod(staff, 'mada', { enabled: true, reason: 'customers ask for it' }), (e: any) => e.code === 'conflict' && /gateway/.test(e.message));
    await assert.rejects(() => updatePaymentMethod(staff, 'bitcoin', { enabled: true, reason: 'why not' }), (e: any) => e.code === 'not_found');
    await assert.rejects(() => updatePaymentMethod(staff, 'bank_transfer', { enabled: false, reason: 'no' }), (e: any) => e.code === 'validation_failed', 'a reason in words');

    await createBankAccount(staff, { ...ACCOUNT, reason: 'our main account' });
    const offered = await checkoutOptions();
    assert.deepEqual(offered.methods, ['bank_transfer']);
    assert.equal(offered.bankTransfer!.accounts[0]!.ibanDisplay, 'SA03 8000 0000 6080 1016 7519');
    assert.equal((offered.bankTransfer!.accounts[0] as any).note, undefined, 'staff notes never reach a checkout');

    await updatePaymentMethod(staff, 'bank_transfer', { enabled: false, reason: 'pausing transfers this week' });
    assert.deepEqual((await checkoutOptions()).methods, [], 'switched off: gone from the checkout');
    await updatePaymentMethod(staff, 'bank_transfer', { enabled: true, config: { graceDays: 3, reminderDays: [5, 1], reviewHours: 12, notifyEmails: ['ops@tajribah.test'] }, reason: 'back on, shorter grace' });
    const settings = await paymentSettingsForStaff();
    assert.deepEqual([settings.bankTransfer.graceDays, settings.bankTransfer.reminderDays, settings.bankTransfer.reviewHours], [3, [5, 1], 12]);
    await assert.rejects(() => updatePaymentMethod(staff, 'bank_transfer', { config: { graceDays: 99 }, reason: 'too long a grace' }), (e: any) => e.code === 'validation_failed' && 'graceDays' in e.errors);
    await assert.rejects(() => updatePaymentMethod(staff, 'bank_transfer', { config: { notifyEmails: ['not-an-email'] }, reason: 'bad address' }), (e: any) => 'notifyEmails' in e.errors);
    await assert.rejects(() => updatePaymentMethod(staff, 'mada', { config: { graceDays: 1 }, reason: 'settings on mada' }), (e: any) => 'config' in e.errors);

    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit));
    assert.equal(trail.filter((t) => t.action === 'payment_method.update').length, 2, 'each change in the staff trail');
    assert.ok(trail.some((t) => t.action === 'bank_account.create'));
    await assert.rejects(() => appDb().select().from(paymentMethodSettings), 'the application role has no grant');
  } finally { await harness.close(); }
});

test('bank accounts: the IBAN is checked and unique; an account a transfer named is switched off, never deleted', async () => {
  const harness = await createTestDb();
  try {
    const { staff, account, alpha } = await setup(harness);
    await assert.rejects(() => createBankAccount(staff, { ...ACCOUNT, iban: 'SA0380000000608010167518', reason: 'a typo in the IBAN' }), (e: any) => /check digits/.test(e.errors.iban[0]));
    await assert.rejects(() => createBankAccount(staff, { ...ACCOUNT, iban: 'sa03 8000 0000 6080 1016 7519', reason: 'again' }), (e: any) => /already/.test(e.errors.iban[0]), 'the same IBAN written differently');
    await assert.rejects(() => createBankAccount(staff, { ...ACCOUNT, iban: IBAN_2, accountNumber: '12ab', reason: 'bad number' }), (e: any) => 'accountNumber' in e.errors);
    await assert.rejects(() => createBankAccount(staff, { ...ACCOUNT, iban: IBAN_2, swift: 'NOPE', reason: 'bad swift' }), (e: any) => 'swift' in e.errors);
    const second = await createBankAccount(staff, { ...ACCOUNT, bankName: 'SNB', bankNameAr: 'البنك الأهلي', iban: IBAN_2, swift: 'NCBKSAJE', note: 'branch: Olaya', reason: 'a second bank' });
    assert.equal(second.swift, 'NCBKSAJE');
    await deleteBankAccount(staff, second.id, 'opened by mistake');
    assert.equal((await rows(harness, () => harness.db.select().from(bankAccounts))).length, 1);

    await submitTransfer(alpha.ctx, order(account.id, await receipt(alpha.ctx)), APP);
    await assert.rejects(() => deleteBankAccount(staff, account.id, 'closing it'), (e: any) => e.code === 'conflict' && /switch it off/.test(e.message));
    const off = await updateBankAccount(staff, account.id, { active: false, reason: 'account closed at the bank' });
    assert.equal(off.active, false);
    assert.equal(off.used, 1, 'staff see it was used');
    assert.deepEqual((await checkoutOptions()).methods, [], 'its last account off: bank transfer leaves the checkout');
  } finally { await harness.close(); }
});

test('a store sends a transfer: priced by the server, its own reference, the account as shown, staff and store told — and only one open at a time', async () => {
  const harness = await createTestDb();
  try {
    const { account, alpha } = await setup(harness);
    const key = await receipt(alpha.ctx);
    const { value: sent, mail } = await captured(() => submitTransfer(alpha.ctx, order(account.id, key, { company: { name: 'شركة فايلت التجارية', vatNumber: '310000000000003', crNumber: '1010101010' } }), APP));
    assert.match(sent.reference, REFERENCE_PATTERN);
    assert.deepEqual([sent.status, sent.plan, sent.cycle, sent.unitPriceMinor, sent.vatMinor, sent.totalMinor], ['pending', 'growth', 'monthly', 29_900, 4_485, 34_385], 'Growth from the plan row, 15% VAT');
    assert.equal(sent.bank.iban, IBAN);
    assert.deepEqual(sent.receipt, { type: 'image/png', bytes: 1200, name: 'receipt.png' });
    assert.deepEqual(sent.company, { name: 'شركة فايلت التجارية', vatNumber: '310000000000003', crNumber: '1010101010' });
    assert.deepEqual(sent.events.map((e) => e.type), ['submitted']);
    assert.match(mail, new RegExp(sent.reference), 'emails name the reference');
    assert.match(mail, /staff@tajribah\.test/, 'staff are told');
    assert.match(mail, /alpha@example\.test/, 'the store’s owner is told');
    const notes = await rows(harness, () => harness.db.select().from(notifications).where(eq(notifications.tenantId, alpha.tenantId)));
    assert.deepEqual(notes.map((n) => n.type), ['transfer.submitted']);

    const summary = await billingSummary(alpha.ctx);
    assert.equal(summary.transfers[0]!.reference, sent.reference);
    assert.deepEqual(summary.checkout.methods, ['bank_transfer']);

    await assert.rejects(() => submitTransfer(alpha.ctx, order(account.id, null), APP), (e: any) => e.code === 'conflict' && /already has a transfer/.test(e.message), 'one open request per store');
    const listed = await listTransfers({ status: 'pending' });
    assert.deepEqual([listed.items.length, listed.counts.pending, listed.items[0]!.storeName], [1, 1, 'alpha']);
    assert.equal((await listTransfers({ q: sent.reference.slice(4) })).items.length, 1, 'found by reference');
    assert.equal((await listTransfers({ q: 'nobody-here' })).items.length, 0);
    const detail = await transferDetail(sent.id);
    assert.equal(detail.preview!.extends, false, 'staff see what approval would grant');
  } finally { await harness.close(); }
});

test('what the store sends is checked: receipt bytes, receipt required, fields, plan, account, and the method being on', async () => {
  const harness = await createTestDb();
  try {
    const { staff, account, alpha } = await setup(harness);
    const html = new TextEncoder().encode('<html><script>alert(1)</script>' + ' '.repeat(400));
    const badKey = await receipt(alpha.ctx, html);
    await assert.rejects(() => submitTransfer(alpha.ctx, order(account.id, badKey), APP), (e: any) => 'receipt' in e.errors);
    assert.equal(await storage().head(badKey), null, 'refused bytes are deleted');
    await assert.rejects(() => submitTransfer(alpha.ctx, order(account.id, null), APP), (e: any) => /attach/.test(e.errors.receipt[0]), 'a receipt is required by default');
    await assert.rejects(() => startReceiptUpload(alpha.ctx, { filename: 'r.exe', contentType: 'application/x-msdownload', sizeBytes: 5000 }), (e: any) => 'contentType' in e.errors);
    await assert.rejects(() => startReceiptUpload(alpha.ctx, { filename: 'r.png', contentType: 'image/png', sizeBytes: 11 * 1024 * 1024 }), (e: any) => 'sizeBytes' in e.errors);
    const good = await receipt(alpha.ctx);
    await assert.rejects(() => submitTransfer(alpha.ctx, order(account.id, good, { senderName: 'x' }), APP), (e: any) => 'senderName' in e.errors);
    await assert.rejects(() => submitTransfer(alpha.ctx, order(account.id, good, { transferredOn: '2099-01-01' }), APP), (e: any) => 'transferredOn' in e.errors, 'not in the future');
    await assert.rejects(() => submitTransfer(alpha.ctx, order(account.id, good, { company: { name: 'Co', vatNumber: '123' } }), APP), (e: any) => 'companyVat' in e.errors);
    setRateLimiter(new MemoryRateLimiter()); // the mistakes above count toward the store's hourly limit
    await assert.rejects(() => submitTransfer(alpha.ctx, order(account.id, good, { plan: 'enterprise' }), APP), (e: any) => 'plan' in e.errors, 'Enterprise is priced by agreement');
    await assert.rejects(() => submitTransfer(alpha.ctx, order(uuidv7(), good), APP), (e: any) => 'bankAccountId' in e.errors);
    const beta = await store(harness, 'beta');
    const betaKey = await receipt(beta.ctx);
    await assert.rejects(() => submitTransfer(alpha.ctx, order(account.id, betaKey), APP), (e: any) => 'receipt' in e.errors, 'another store’s upload is not this store’s receipt');
    await updatePaymentMethod(staff, 'bank_transfer', { enabled: false, reason: 'paused for the audit' });
    await assert.rejects(() => submitTransfer(alpha.ctx, order(account.id, good), APP), (e: any) => e.code === 'conflict' && /not offered/.test(e.message));
    await updatePaymentMethod(staff, 'bank_transfer', { enabled: true, config: { receiptRequired: false }, reason: 'receipts optional now' });
    const noReceipt = await submitTransfer(alpha.ctx, order(account.id, null), APP);
    assert.equal(noReceipt.receipt, null, 'staff may make the receipt optional');
    assert.equal((await rows(harness, () => harness.db.select().from(bankTransferRequests))).length, 1, 'only the good one was kept');
  } finally { await harness.close(); }
});

test('approval: the plan is on, a paid tax invoice for exactly what was quoted, the payment, both trails — once', async () => {
  const harness = await createTestDb();
  try {
    const { staff, account, alpha } = await setup(harness);
    const sent = await submitTransfer(alpha.ctx, order(account.id, await receipt(alpha.ctx), { company: { name: 'Failet Trading Co', vatNumber: '310000000000003', crNumber: '1010101010' } }), APP);
    await assert.rejects(() => approveTransfer(staff, sent.id, { confirmed: false }, APP), (e: any) => 'confirmed' in e.errors, 'staff confirm the money arrived');
    const now = new Date();
    const { value: done, mail } = await captured(() => approveTransfer(staff, sent.id, { confirmed: true, note: 'seen on the 10 Oct statement' }, APP, now));
    assert.equal(done.status, 'approved');
    assert.ok(done.invoiceId && done.invoiceNumber);
    assert.equal(done.periodEnd, addMonths(now, 1).toISOString());

    const [sub] = await rows(harness, () => harness.db.select().from(subscriptions).where(eq(subscriptions.tenantId, alpha.tenantId)));
    assert.deepEqual([sub!.status, sub!.provider, sub!.billingCycle, sub!.currentPeriodEnd.toISOString()], ['active', 'bank_transfer', 'monthly', addMonths(now, 1).toISOString()]);
    const [tenant] = await rows(harness, () => harness.db.select().from(tenants).where(eq(tenants.id, alpha.tenantId)));
    assert.equal(tenant!.status, 'active', 'a trial store becomes active');
    const [invoice] = await rows(harness, () => harness.db.select().from(invoices).where(eq(invoices.id, done.invoiceId!)));
    assert.deepEqual([invoice!.status, invoice!.subtotalMinor, invoice!.vatMinor, invoice!.totalMinor], ['paid', 29_900, 4_485, 34_385]);
    assert.deepEqual([invoice!.buyerName, invoice!.buyerVatNumber, invoice!.buyerCrNumber], ['Failet Trading Co', '310000000000003', '1010101010'], 'bought for a company: the company is the buyer');
    const [payment] = await rows(harness, () => harness.db.select().from(payments).where(eq(payments.tenantId, alpha.tenantId)));
    assert.deepEqual([payment!.status, payment!.method, payment!.provider, payment!.providerPaymentId, payment!.amountMinor], ['captured', 'bank_transfer', 'bank_transfer', sent.reference, 34_385]);
    const audit = await rows(harness, () => harness.db.select().from(auditLogs).where(and(eq(auditLogs.tenantId, alpha.tenantId), eq(auditLogs.action, 'plan_change'))));
    assert.equal(audit.length, 1, 'in the store’s own trail');
    assert.equal(audit[0]!.actorType, 'staff');
    const trail = await rows(harness, () => harness.db.select().from(staffAudit).where(eq(staffAudit.action, 'bank_transfer.approve')));
    assert.equal(trail.length, 1);
    assert.match(mail, /Your plan is on|تم تفعيل اشتراكك/);
    assert.deepEqual(done.events.map((e) => e.type), ['submitted', 'approved', 'note']);
    const storeView = (await transfersOf(alpha.ctx))[0]!;
    assert.deepEqual(storeView.events.map((e) => e.type), ['submitted', 'approved'], 'staff notes never reach the store');

    await assert.rejects(() => approveTransfer(staff, sent.id, { confirmed: true }, APP), (e: any) => e.code === 'conflict', 'a second approval changes nothing');
    await assert.rejects(() => rejectTransfer(staff, sent.id, { message: 'too late to decline' }, APP), (e: any) => e.code === 'conflict');
    assert.equal((await rows(harness, () => harness.db.select().from(invoices))).length, 1);
    const summary = await billingSummary(alpha.ctx);
    assert.deepEqual([summary.status, summary.plan, summary.paidBy], ['active', 'growth', 'bank_transfer']);
  } finally { await harness.close(); }
});

test('a renewal extends from the paid end; a change of plan starts now and carries the paid days over; a suspended store stays suspended', async () => {
  const harness = await createTestDb();
  try {
    const { staff, account, alpha } = await setup(harness);
    const t0 = new Date('2026-10-10T09:00:00Z');
    const first = await submitTransfer(alpha.ctx, order(account.id, await receipt(alpha.ctx)), APP, t0);
    await approveTransfer(staff, first.id, { confirmed: true }, APP, t0);
    const t1 = new Date(t0.getTime() + 20 * DAY); // 10 days left
    const renewal = await submitTransfer(alpha.ctx, order(account.id, await receipt(alpha.ctx)), APP, t1);
    const renewed = await approveTransfer(staff, renewal.id, { confirmed: true }, APP, t1);
    assert.equal(renewed.periodEnd, addMonths(addMonths(t0, 1), 1).toISOString(), 'the new month starts where the paid one ends');

    const t2 = new Date(t1.getTime() + 30 * DAY);
    const change = await submitTransfer(alpha.ctx, order(account.id, await receipt(alpha.ctx), { plan: 'pro' }), APP, t2);
    const changed = await approveTransfer(staff, change.id, { confirmed: true }, APP, t2);
    const left = addMonths(addMonths(t0, 1), 1).getTime() - t2.getTime();
    const carried = Math.floor((left * 29_900) / 99_900 / DAY);
    assert.equal(changed.periodEnd, new Date(addMonths(t2, 1).getTime() + carried * DAY).toISOString(), 'Growth days left, worth fewer Pro days');
    assert.equal((await billingSummary(alpha.ctx)).plan, 'pro');

    const gamma = await store(harness, 'gamma');
    const sent = await submitTransfer(gamma.ctx, order(account.id, await receipt(gamma.ctx)), APP);
    await harness.asAdmin(() => harness.db.update(tenants).set({ status: 'suspended' }).where(eq(tenants.id, gamma.tenantId))); // staff suspend it while the transfer waits
    await approveTransfer(staff, sent.id, { confirmed: true }, APP);
    const [g] = await rows(harness, () => harness.db.select().from(tenants).where(eq(tenants.id, gamma.tenantId)));
    assert.equal(g!.status, 'suspended', 'paying does not undo a suspension');
  } finally { await harness.close(); }
});

test('a coupon is held while the request is open, and given back when it is declined or cancelled', async () => {
  const harness = await createTestDb();
  try {
    const { staff, account, alpha } = await setup(harness);
    await harness.asAdmin(() => harness.db.insert(coupons).values({ id: uuidv7(), code: 'BANK20', kind: 'percent', percentOff: 20, maxRedemptions: 1, active: true } as any));
    const sent = await submitTransfer(alpha.ctx, order(account.id, await receipt(alpha.ctx), { couponCode: 'bank20' }), APP);
    assert.deepEqual([sent.couponCode, sent.discountMinor, sent.totalMinor], ['BANK20', 5_980, Math.round((29_900 - 5_980) * 1.15)]);
    assert.equal((await rows(harness, () => harness.db.select().from(couponRedemptions))).length, 1, 'held');
    const beta = await store(harness, 'beta');
    await assert.rejects(async () => submitTransfer(beta.ctx, order(account.id, await receipt(beta.ctx), { couponCode: 'BANK20' }), APP), (e: any) => /used up/.test(JSON.stringify(e.errors ?? e.message)), 'its one use is held by alpha');
    await cancelTransfer(alpha.ctx, sent.id, APP);
    assert.equal((await rows(harness, () => harness.db.select().from(couponRedemptions))).length, 0, 'cancelled: given back');

    const again = await submitTransfer(beta.ctx, order(account.id, await receipt(beta.ctx), { couponCode: 'BANK20' }), APP);
    const { mail } = await captured(() => rejectTransfer(staff, again.id, { message: 'The money has not reached our account.' }, APP));
    assert.match(mail, /has not reached our account/, 'the store reads staff’s own words');
    assert.equal((await rows(harness, () => harness.db.select().from(couponRedemptions))).length, 0, 'declined: given back');
    const declined = (await transfersOf(beta.ctx))[0]!;
    assert.deepEqual([declined.status, declined.decisionMessage], ['rejected', 'The money has not reached our account.']);
    await assert.rejects(async () => rejectTransfer(staff, (await submitTransfer(alpha.ctx, order(account.id, await receipt(alpha.ctx)), APP)).id, { message: 'no' }, APP), (e: any) => 'message' in e.errors, 'a reason in words');
  } finally { await harness.close(); }
});

test('staff ask for more; the store sends it again with a new receipt; notes stay with staff', async () => {
  const harness = await createTestDb();
  try {
    const { staff, account, alpha } = await setup(harness);
    const oldKey = await receipt(alpha.ctx);
    const sent = await submitTransfer(alpha.ctx, order(account.id, oldKey), APP);
    await assert.rejects(() => resubmitTransfer(alpha.ctx, sent.id, { senderName: 'Nader S.' }, APP), (e: any) => e.code === 'conflict', 'nothing was asked yet');
    const { mail } = await captured(() => requestTransferInfo(staff, sent.id, { message: 'The receipt is cut off — please attach the whole page.' }, APP));
    assert.match(mail, /cut off/);
    await noteTransfer(staff, sent.id, { note: 'checked SNB statement, nothing yet' });
    const waiting = (await transfersOf(alpha.ctx))[0]!;
    assert.deepEqual([waiting.status, waiting.decisionMessage], ['info_requested', 'The receipt is cut off — please attach the whole page.']);
    assert.ok(!waiting.events.some((e) => e.type === 'note'), 'the staff note is not shown to the store');

    const newKey = await receipt(alpha.ctx, PNG(2400));
    const { value: again, mail: staffMail } = await captured(() => resubmitTransfer(alpha.ctx, sent.id, { receiptKey: newKey, note: 'whole page attached' }, APP));
    assert.deepEqual([again.status, again.receipt?.bytes], ['pending', 2400]);
    assert.equal(await storage().head(oldKey), null, 'the replaced receipt is gone');
    assert.match(staffMail, /sent again|أعاد المتجر/);
    const detail = await transferDetail(sent.id);
    assert.deepEqual(detail.events.map((e) => e.type), ['submitted', 'info_requested', 'note', 'resubmitted']);
    assert.equal(detail.staffNote, 'checked SNB statement, nothing yet');
    await assert.rejects(() => requestTransferInfo(staff, sent.id, { message: 'x' }, APP), (e: any) => 'message' in e.errors);
    await approveTransfer(staff, sent.id, { confirmed: true }, APP);
    // the timeline is append-only for the application role
    await assert.rejects(() => appDb().transaction(async (tx: any) => {
      await tx.execute(sql`select set_config('app.tenant_id', ${alpha.tenantId}, true)`);
      await tx.update(bankTransferEvents).set({ message: 'rewritten' });
    }));
  } finally { await harness.close(); }
});

test('one store never sees another’s transfer or its receipt', async () => {
  const harness = await createTestDb();
  try {
    const { account, alpha } = await setup(harness);
    const sent = await submitTransfer(alpha.ctx, order(account.id, await receipt(alpha.ctx)), APP);
    const beta = await store(harness, 'beta');
    assert.deepEqual(await transfersOf(beta.ctx), []);
    await assert.rejects(() => receiptBody(beta.tenantId, sent.id), (e: any) => e.code === 'not_found');
    await assert.rejects(() => cancelTransfer(beta.ctx, sent.id, APP), (e: any) => e.code === 'not_found');
    const own = await receiptBody(alpha.tenantId, sent.id);
    assert.equal(own.type, 'image/png');
    assert.match(own.name, new RegExp(`^${sent.reference}-receipt\\.png$`));
    await assert.rejects(() => appDb().select().from(bankAccounts), 'the app role cannot read the platform accounts directly');
  } finally { await harness.close(); }
});

test('plans paid by transfer: one reminder before the end, past due at the end, read-only after the grace days — not while a transfer waits', async () => {
  const harness = await createTestDb();
  try {
    const { staff, account, alpha } = await setup(harness);
    const t0 = new Date('2026-10-10T09:00:00Z');
    const sent = await submitTransfer(alpha.ctx, order(account.id, await receipt(alpha.ctx)), APP, t0);
    await approveTransfer(staff, sent.id, { confirmed: true }, APP, t0);
    const end = addMonths(t0, 1);
    const at = (ms: number) => new Date(end.getTime() + ms);
    const sub = async () => (await rows(harness, () => harness.db.select().from(subscriptions).where(eq(subscriptions.tenantId, alpha.tenantId))))[0]!;
    const tenantStatus = async () => (await rows(harness, () => harness.db.select().from(tenants).where(eq(tenants.id, alpha.tenantId))))[0]!.status;

    assert.deepEqual(await sweepTransferRenewals(at(-20 * DAY), 200, APP), { reminded: 0, pastDue: 0, expired: 0 }, 'far from the end: nothing');
    assert.equal((await sweepTransferRenewals(at(-6 * DAY), 200, APP)).reminded, 1, 'a week before: the 7-day reminder');
    assert.equal((await sweepTransferRenewals(at(-5 * DAY), 200, APP)).reminded, 0, 'once');
    const { value: first, mail } = await captured(() => sweepTransferRenewals(at(-1.5 * DAY), 200, APP));
    assert.equal(first.reminded, 1, 'then the 2-day reminder, once');
    const reminders = await rows(harness, () => harness.db.select().from(notifications).where(and(eq(notifications.tenantId, alpha.tenantId), eq(notifications.type, 'subscription.renewal'))));
    assert.deepEqual(reminders.map((n) => n.href!.split('&d=')[1]).sort(), ['2', '7'], 'one of each');
    assert.match(mail, /ends in 2 days|بعد 2|بعد يومين/);
    assert.equal((await sweepTransferRenewals(at(-1.4 * DAY), 200, APP)).reminded, 0, 'once');

    assert.equal((await sweepTransferRenewals(at(DAY), 200, APP)).pastDue, 1);
    assert.deepEqual([(await sub()).status, await tenantStatus()], ['past_due', 'past_due'], 'still working (past due is not read-only)');
    assert.equal((await sweepTransferRenewals(at(6 * DAY), 200, APP)).expired, 0, 'inside the 7 grace days');

    // a renewal waiting on staff holds off the read-only step
    const renewal = await submitTransfer(alpha.ctx, order(account.id, await receipt(alpha.ctx)), APP, at(6 * DAY));
    assert.equal((await sweepTransferRenewals(at(9 * DAY), 200, APP)).expired, 0, 'the store paid; the wait is ours');
    await cancelTransfer(alpha.ctx, renewal.id, APP);
    const { value: gone, mail: lastMail } = await captured(() => sweepTransferRenewals(at(9 * DAY), 200, APP));
    assert.equal(gone.expired, 1);
    assert.deepEqual([(await sub()).status, await tenantStatus()], ['expired', 'cancelled']);
    assert.match(lastMail, /read-only|للاطلاع فقط/);
    assert.equal((await billingSummary(alpha.ctx)).status, 'expired');

    // renewing brings it back
    const back = await submitTransfer(alpha.ctx, order(account.id, await receipt(alpha.ctx)), APP, at(10 * DAY));
    await approveTransfer(staff, back.id, { confirmed: true }, APP, at(10 * DAY));
    assert.deepEqual([(await sub()).status, await tenantStatus()], ['active', 'active']);
    assert.equal((await sub()).currentPeriodEnd.toISOString(), addMonths(at(10 * DAY), 1).toISOString(), 'an expired plan starts again from the day it is paid');
    void unsafeAdminDb;
  } finally { await harness.close(); }
});
