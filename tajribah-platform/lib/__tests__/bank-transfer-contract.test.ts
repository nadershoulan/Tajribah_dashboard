/**
 * T129 — the bank transfer rules both sides share: IBAN check digits, the reference, the receipt judged by its bytes,
 * the period a transfer buys, and bank transfer's settings read safely.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  REFERENCE_PATTERN, addMonths, formatIban, ibanChecksumOk, ibanProblem, normaliseIban, periodFor, receiptTypeOf, referenceFrom, sniffReceipt,
} from '@/lib/contracts/bank-transfer';
import { BANK_TRANSFER_DEFAULTS, PAYMENT_METHODS, bankTransferConfig, isPaymentMethodKey } from '@/lib/payment-methods';

/** A Saudi IBAN for a 20-digit bank + account number of our choosing, with its check digits computed (ISO 13616). */
export function saudiIban(bban: string): string {
  const numeric = (bban + 'SA00').replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const d of numeric) rest = (rest * 10 + Number(d)) % 97;
  return `SA${String(98 - rest).padStart(2, '0')}${bban}`;
}

test('IBAN: the registry’s Saudi example passes; one wrong digit, a swap, or the wrong shape does not', () => {
  const example = 'SA03 8000 0000 6080 1016 7519'; // the ISO 13616 registry's example for Saudi Arabia
  assert.equal(ibanProblem(example), null);
  assert.equal(normaliseIban(' sa03-8000 0000 6080 1016 7519 '), 'SA0380000000608010167519');
  assert.equal(formatIban('SA0380000000608010167519'), 'SA03 8000 0000 6080 1016 7519');
  assert.match(ibanProblem('SA0380000000608010167518')!, /check digits/, 'last digit wrong');
  assert.match(ibanProblem('SA0380000000608010165719')!, /check digits/, 'two digits swapped');
  assert.match(ibanProblem('SA038000000060801016751')!, /22 digits/, 'one digit short');
  assert.match(ibanProblem('GB82WEST12345698765432')!, /Saudi/, 'a valid IBAN, but not Saudi');
  assert.equal(ibanChecksumOk('GB82WEST12345698765432'), true, 'the check itself is the international one');
  assert.equal(ibanProblem(saudiIban('80000000608010999999')), null, 'computed check digits pass');
});

test('the reference: TJR- and six characters that cannot be misread; random bytes map onto the alphabet', () => {
  const ref = referenceFrom(new Uint8Array([0, 1, 2, 29, 30, 255]));
  assert.match(ref, REFERENCE_PATTERN);
  assert.equal(ref, 'TJR-234ZBH'.slice(0, 4) + ref.slice(4), 'shape');
  for (let i = 0; i < 200; i++) assert.match(referenceFrom(crypto.getRandomValues(new Uint8Array(6))), REFERENCE_PATTERN);
  assert.doesNotMatch('TJR-0O1IL5', REFERENCE_PATTERN, 'no 0, O, 1, I or L');
  assert.throws(() => referenceFrom(new Uint8Array(5)));
});

test('the receipt is judged by its bytes: PNG, JPEG, WebP, PDF — a renamed file or an HTML page is not', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);
  const jpg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x57, 0x45, 0x42, 0x50]);
  const pdf = new TextEncoder().encode('%PDF-1.7\n');
  assert.deepEqual([png, jpg, webp, pdf].map(sniffReceipt), ['image/png', 'image/jpeg', 'image/webp', 'application/pdf']);
  assert.equal(sniffReceipt(new TextEncoder().encode('<html><script>')), null);
  assert.equal(sniffReceipt(new TextEncoder().encode('%PDF')), null, 'a PDF starts %PDF-');
  assert.equal(sniffReceipt(new Uint8Array([0x52, 0x49, 0x46, 0x46, 1, 2, 3, 4, 0x41, 0x56, 0x49, 0x20])), null, 'RIFF but not WebP');
  assert.equal(receiptTypeOf({ name: 'Receipt.JPEG', type: '' }), 'image/jpeg');
  assert.equal(receiptTypeOf({ name: 'r.pdf', type: 'application/pdf' }), 'application/pdf');
  assert.equal(receiptTypeOf({ name: 'r.heic', type: 'image/heic' }), null);
});

test('months add on the calendar, holding the day where the month allows', () => {
  const at = (s: string) => new Date(`${s}T09:00:00Z`);
  assert.equal(addMonths(at('2026-01-31'), 1).toISOString().slice(0, 10), '2026-02-28');
  assert.equal(addMonths(at('2028-01-31'), 1).toISOString().slice(0, 10), '2028-02-29', 'leap year');
  assert.equal(addMonths(at('2026-10-10'), 12).toISOString().slice(0, 10), '2027-10-10');
  assert.equal(addMonths(at('2026-12-15'), 1).toISOString().slice(0, 10), '2027-01-15');
  assert.equal(addMonths(at('2026-10-10'), 1).getUTCHours(), 9, 'the time of day is kept');
});

test('the period: a first plan starts now; a renewal extends from the end; a change carries the paid days over at their value', () => {
  const now = new Date('2026-10-10T12:00:00Z');
  const day = 86_400_000;
  const first = periodFor({ now, current: null, planCode: 'growth', cycle: 'monthly', newMonthlyMinor: 29_900 });
  assert.deepEqual([first.start, first.end.toISOString().slice(0, 10), first.extends, first.carriedDays], [now, '2026-11-10', false, 0]);
  assert.equal(periodFor({ now, current: null, planCode: 'growth', cycle: 'annual', newMonthlyMinor: 29_900 }).end.toISOString().slice(0, 10), '2027-10-10');
  assert.equal(periodFor({ now, current: null, planCode: 'growth', cycle: 'monthly', freeMonths: 2, newMonthlyMinor: 29_900 }).end.toISOString().slice(0, 10), '2027-01-10', 'free months added');

  const paid = { planCode: 'growth', status: 'active' as const, periodStart: new Date(now.getTime() - 20 * day), periodEnd: new Date(now.getTime() + 10 * day), monthlyMinor: 29_900 };
  const renew = periodFor({ now, current: paid, planCode: 'growth', cycle: 'monthly', newMonthlyMinor: 29_900 });
  assert.equal(renew.extends, true);
  assert.equal(renew.start.getTime(), paid.periodStart.getTime(), 'the period keeps its start');
  assert.equal(renew.end.toISOString().slice(0, 10), '2026-11-20', 'a month after the paid end (20 Oct) — paying early loses nothing');

  const up = periodFor({ now, current: paid, planCode: 'pro', cycle: 'monthly', newMonthlyMinor: 99_900 });
  assert.equal(up.start.getTime(), now.getTime(), 'a new plan starts now');
  assert.equal(up.carriedDays, Math.floor((10 * 29_900) / 99_900), '10 Growth days are worth 2 Pro days');
  assert.equal(up.end.getTime(), addMonths(now, 1).getTime() + up.carriedDays * day);
  const down = periodFor({ now, current: { ...paid, planCode: 'pro', monthlyMinor: 99_900 }, planCode: 'starter', cycle: 'monthly', newMonthlyMinor: 9_900 });
  assert.equal(down.carriedDays, Math.floor((10 * 99_900) / 9_900), '10 Pro days are worth 100 Starter days');

  const ended = periodFor({ now, current: { ...paid, periodEnd: new Date(now.getTime() - day) }, planCode: 'growth', cycle: 'monthly', newMonthlyMinor: 29_900 });
  assert.deepEqual([ended.start, ended.extends], [now, false], 'nothing left to extend: starts now');
  const trial = periodFor({ now, current: { ...paid, status: 'trialing' }, planCode: 'growth', cycle: 'monthly', newMonthlyMinor: 29_900 });
  assert.deepEqual([trial.start, trial.carriedDays], [now, 0], 'trial days are not paid days');
  const pastDue = periodFor({ now, current: { ...paid, status: 'past_due' }, planCode: 'growth', cycle: 'monthly', newMonthlyMinor: 29_900 });
  assert.equal(pastDue.extends, true, 'past due with time left still extends');
});

test('bank transfer settings read safely: bad values fall back, lists are cleaned; the registry knows its methods', () => {
  assert.deepEqual(bankTransferConfig(null), BANK_TRANSFER_DEFAULTS);
  const c = bankTransferConfig({ graceDays: 99, reminderDays: [2, 7, 7, 0, 40, 1.5], reviewHours: 0, notifyEmails: ['ops@tajribah.org', 'nope'], instructions: { ar: ' حوّل ', en: '' }, receiptRequired: false });
  assert.equal(c.graceDays, BANK_TRANSFER_DEFAULTS.graceDays);
  assert.deepEqual(c.reminderDays, [7, 2], 'deduplicated, in range, largest first');
  assert.equal(c.reviewHours, BANK_TRANSFER_DEFAULTS.reviewHours);
  assert.deepEqual(c.notifyEmails, ['ops@tajribah.org']);
  assert.deepEqual(c.instructions, { ar: 'حوّل', en: '' });
  assert.equal(c.receiptRequired, false);
  assert.deepEqual(PAYMENT_METHODS.filter((m) => m.ready).map((m) => m.key), ['bank_transfer'], 'only bank transfer takes money today');
  assert.equal(isPaymentMethodKey('tabby'), true);
  assert.equal(isPaymentMethodKey('bitcoin'), false);
});
