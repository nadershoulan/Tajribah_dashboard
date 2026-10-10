/**
 * T129 — the payment methods staff offer and Tajribah's bank accounts: what a checkout may show, and the staff
 * console's «طرق الدفع» page that changes them.
 *
 * Rules that are not style choices:
 *  - **A method reaches a checkout only when it is ready (code) and enabled (staff).** Switching on a method whose
 *    gateway is not wired is refused — a store would pick it and nothing would take the money.
 *  - **Bank transfer is offered only with at least one active account**: no account, nothing to transfer to.
 *  - **An IBAN is checked (mod 97) before it is saved**, and is unique: one wrong digit sends every store's money
 *    elsewhere.
 *  - **An account a transfer named is never deleted**, only switched off; transfers keep a snapshot of it anyway.
 *  - Every change is a staff action with its reason, in the staff trail.
 *
 * Platform tables (EXEMPT): read and written through the admin handle; no store's data.
 */
import { asc, eq } from 'drizzle-orm';
import { unsafeAdminDb, type Db } from '@/db/client';
import { bankAccounts, bankTransferRequests, paymentMethodSettings, type BankAccount } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { formatIban, ibanProblem, normaliseIban } from '@/lib/contracts/bank-transfer';
import {
  BANK_TRANSFER_DEFAULTS, PAYMENT_METHODS, bankTransferConfig, isPaymentMethodKey, paymentMethod,
  type BankAccountView, type BankTransferConfig, type CheckoutOptions, type PaymentMethodKey,
} from '@/lib/payment-methods';

export type { BankAccountView, CheckoutOptions };
import { errors } from '@/server/core/errors/problem';
import { staffLog, type StaffContext } from '@/server/modules/admin/access';

// ------------------------------------------------------------------ views

export type PaymentMethodRow = {
  key: PaymentMethodKey; kind: 'offline' | 'online'; provider: string | null; ready: boolean;
  enabled: boolean; sortOrder: number; updatedAt: string | null;
};
export type BankAccountStaffView = BankAccountView & { note: string | null; used: number; createdAt: string };
export type PaymentSettingsForStaff = { methods: PaymentMethodRow[]; bankTransfer: BankTransferConfig; accounts: BankAccountStaffView[] };

const accountView = (a: BankAccount): BankAccountView => ({
  id: a.id, bankName: a.bankName, bankNameAr: a.bankNameAr, accountHolder: a.accountHolder, accountNumber: a.accountNumber,
  iban: a.iban, ibanDisplay: formatIban(a.iban), swift: a.swift, currency: a.currency, active: a.active, sortOrder: a.sortOrder,
});

async function settingsRows() {
  return unsafeAdminDb().select().from(paymentMethodSettings);
}

/** Every method of the registry with its row (a method with no row yet reads as off). */
async function methodRows(): Promise<(PaymentMethodRow & { config: unknown })[]> {
  const rows = new Map((await settingsRows()).map((r) => [r.key, r]));
  return PAYMENT_METHODS.map((m, i) => {
    const row = rows.get(m.key);
    return {
      key: m.key, kind: m.kind, provider: m.provider, ready: m.ready,
      // a method that is not ready is never on, whatever an old row says
      enabled: m.ready && !!row?.enabled, sortOrder: row?.sortOrder ?? (i + 1) * 10,
      updatedAt: row?.updatedAt.toISOString() ?? null, config: row?.config ?? null,
    };
  }).sort((a, b) => a.sortOrder - b.sortOrder || a.key.localeCompare(b.key));
}

export async function bankTransferSettings(): Promise<BankTransferConfig> {
  const [row] = await unsafeAdminDb().select().from(paymentMethodSettings).where(eq(paymentMethodSettings.key, 'bank_transfer')).limit(1);
  return bankTransferConfig(row?.config ?? BANK_TRANSFER_DEFAULTS);
}

export async function activeBankAccounts(): Promise<BankAccount[]> {
  return unsafeAdminDb().select().from(bankAccounts).where(eq(bankAccounts.active, true)).orderBy(asc(bankAccounts.sortOrder), asc(bankAccounts.createdAt));
}

export async function checkoutOptions(): Promise<CheckoutOptions> {
  const methods = (await methodRows()).filter((m) => m.enabled);
  const accounts = methods.some((m) => m.key === 'bank_transfer') ? await activeBankAccounts() : [];
  const offered = methods.filter((m) => m.key !== 'bank_transfer' || accounts.length > 0).map((m) => m.key);
  const config = bankTransferConfig(methods.find((m) => m.key === 'bank_transfer')?.config);
  return {
    methods: offered,
    bankTransfer: offered.includes('bank_transfer')
      ? { accounts: accounts.map(accountView), config: { receiptRequired: config.receiptRequired, reviewHours: config.reviewHours, instructions: config.instructions } }
      : null,
  };
}

/** Whether a store may pay by bank transfer right now, and to this account. */
export async function assertTransferAccount(accountId: string): Promise<BankAccount> {
  const options = await methodRows();
  if (!options.find((m) => m.key === 'bank_transfer')?.enabled) throw errors.conflict('bank transfer is not offered at the moment');
  const [account] = await unsafeAdminDb().select().from(bankAccounts).where(eq(bankAccounts.id, accountId)).limit(1);
  if (!account || !account.active) throw errors.validation({ bankAccountId: ['choose one of the accounts shown'] });
  return account;
}

export async function paymentSettingsForStaff(): Promise<PaymentSettingsForStaff> {
  const db = unsafeAdminDb();
  const [methods, accounts, requests] = await Promise.all([
    methodRows(),
    db.select().from(bankAccounts).orderBy(asc(bankAccounts.sortOrder), asc(bankAccounts.createdAt)),
    db.select({ bankAccountId: bankTransferRequests.bankAccountId }).from(bankTransferRequests),
  ]);
  const used = new Map<string, number>();
  for (const r of requests) used.set(r.bankAccountId, (used.get(r.bankAccountId) ?? 0) + 1);
  return {
    methods: methods.map((m) => ({ key: m.key, kind: m.kind, provider: m.provider, ready: m.ready, enabled: m.enabled, sortOrder: m.sortOrder, updatedAt: m.updatedAt })),
    bankTransfer: bankTransferConfig(methods.find((m) => m.key === 'bank_transfer')?.config),
    accounts: accounts.map((a) => ({ ...accountView(a), note: a.note, used: used.get(a.id) ?? 0, createdAt: a.createdAt.toISOString() })),
  };
}

// ------------------------------------------------------------------ staff changes

const why = (reason: string) => {
  const r = reason.trim();
  if (r.length < 5) throw errors.validation({ reason: ['say why, in a few words'] });
  return r;
};

/** Switch a method on or off, move it, or (bank transfer) change its settings. */
export async function updatePaymentMethod(
  staff: StaffContext, key: string,
  input: { enabled?: boolean; sortOrder?: number; config?: Partial<BankTransferConfig>; reason: string },
  now = new Date(),
): Promise<PaymentSettingsForStaff> {
  const reason = why(input.reason);
  if (!isPaymentMethodKey(key)) throw errors.notFound('payment method');
  const info = paymentMethod(key)!;
  if (input.enabled && !info.ready) {
    throw errors.conflict(`${info.label.en} cannot be switched on yet: its payment gateway (${info.provider}) is not connected`);
  }
  if (input.sortOrder !== undefined && (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 1000)) {
    throw errors.validation({ sortOrder: ['a whole number from 0 to 1000'] });
  }
  if (input.config !== undefined && key !== 'bank_transfer') throw errors.validation({ config: ['only bank transfer has settings'] });

  await unsafeAdminDb().transaction(async (tx) => {
    const [before] = await tx.select().from(paymentMethodSettings).where(eq(paymentMethodSettings.key, key)).for('update').limit(1);
    let config = before?.config ?? null;
    if (input.config !== undefined) {
      const merged = { ...bankTransferConfig(before?.config), ...input.config };
      const clean = bankTransferConfig(merged);
      // a value the reader would quietly replace is refused instead, so staff see what was wrong
      const problems: Record<string, string[]> = {};
      if (merged.graceDays !== clean.graceDays) problems.graceDays = ['0 to 30 days'];
      if (merged.reviewHours !== clean.reviewHours) problems.reviewHours = ['1 to 240 hours'];
      if (Array.isArray(merged.notifyEmails) && merged.notifyEmails.length !== clean.notifyEmails.length) problems.notifyEmails = ['email addresses, up to 10'];
      if (Array.isArray(merged.reminderDays) && merged.reminderDays.length !== clean.reminderDays.length) problems.reminderDays = ['1 to 30 days each, up to 4, no repeats'];
      if (Object.keys(problems).length) throw errors.validation(problems);
      config = clean as unknown as Record<string, unknown>;
    }
    const values = {
      enabled: input.enabled ?? before?.enabled ?? false,
      sortOrder: input.sortOrder ?? before?.sortOrder ?? (PAYMENT_METHODS.findIndex((m) => m.key === key) + 1) * 10,
      config, updatedBy: staff.userId, updatedAt: now,
    };
    await tx.insert(paymentMethodSettings).values({ key, ...values })
      .onConflictDoUpdate({ target: paymentMethodSettings.key, set: values });
    await staffLog(staff, {
      action: 'payment_method.update', targetType: 'payment_method', targetId: null, reason,
      detail: { key, before: before ? { enabled: before.enabled, sortOrder: before.sortOrder, config: before.config } : null, after: values },
    }, tx as unknown as Db);
  });
  return paymentSettingsForStaff();
}

export type BankAccountInput = {
  bankName: string; bankNameAr: string; accountHolder: string; accountNumber: string; iban: string;
  swift?: string | null; active?: boolean; sortOrder?: number; note?: string | null;
};

function cleanAccount(input: Partial<BankAccountInput>, partial: boolean): Partial<typeof bankAccounts.$inferInsert> {
  const problems: Record<string, string[]> = {};
  const out: Partial<typeof bankAccounts.$inferInsert> = {};
  const text = (field: keyof BankAccountInput, min: number, max: number) => {
    const v = input[field];
    if (v === undefined) { if (!partial) problems[field] = ['required']; return; }
    const t = String(v).trim().replace(/\s+/g, ' ');
    if (t.length < min || t.length > max) problems[field] = [`${min} to ${max} characters`];
    else (out as Record<string, unknown>)[field] = t;
  };
  text('bankName', 2, 80);
  text('bankNameAr', 2, 80);
  text('accountHolder', 2, 140);
  if (input.accountNumber !== undefined) {
    const n = String(input.accountNumber).replace(/[\s-]/g, '');
    if (!/^\d{6,24}$/.test(n)) problems.accountNumber = ['6 to 24 digits'];
    else out.accountNumber = n;
  } else if (!partial) problems.accountNumber = ['required'];
  if (input.iban !== undefined) {
    const problem = ibanProblem(String(input.iban));
    if (problem) problems.iban = [problem];
    else out.iban = normaliseIban(String(input.iban));
  } else if (!partial) problems.iban = ['required'];
  if (input.swift !== undefined) {
    const s = input.swift ? String(input.swift).replace(/\s/g, '').toUpperCase() : null;
    if (s && !/^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/.test(s)) problems.swift = ['a SWIFT/BIC code is 8 or 11 letters and digits'];
    else out.swift = s;
  }
  if (input.active !== undefined) out.active = !!input.active;
  if (input.sortOrder !== undefined) {
    if (!Number.isInteger(input.sortOrder) || input.sortOrder < 0 || input.sortOrder > 1000) problems.sortOrder = ['a whole number from 0 to 1000'];
    else out.sortOrder = input.sortOrder;
  }
  if (input.note !== undefined) {
    const n = input.note?.trim() || null;
    if (n && n.length > 500) problems.note = ['500 characters at most'];
    else out.note = n;
  }
  if (Object.keys(problems).length) throw errors.validation(problems);
  return out;
}

const DUPLICATE_IBAN = { iban: ['this IBAN is already one of the accounts'] };
/** A unique-key refusal, whether the driver throws it directly or wraps it (drizzle puts it in `cause`). */
const isUnique = (e: unknown): boolean => {
  const err = e as { message?: string; code?: string; cause?: unknown } | null;
  if (!err) return false;
  return err.code === '23505' || /bank_accounts_iban_unq|duplicate key/.test(String(err.message ?? '')) || (!!err.cause && isUnique(err.cause));
};

export async function createBankAccount(staff: StaffContext, input: BankAccountInput & { reason: string }): Promise<BankAccountStaffView> {
  const reason = why(input.reason);
  const values = cleanAccount(input, false);
  const id = uuidv7();
  try {
    await unsafeAdminDb().transaction(async (tx) => {
      await tx.insert(bankAccounts).values({ id, ...values } as typeof bankAccounts.$inferInsert);
      await staffLog(staff, { action: 'bank_account.create', targetType: 'bank_account', targetId: id, reason, detail: { bankName: values.bankName, iban: values.iban } }, tx as unknown as Db);
    });
  } catch (e) {
    if (isUnique(e)) throw errors.validation(DUPLICATE_IBAN);
    throw e;
  }
  return (await paymentSettingsForStaff()).accounts.find((a) => a.id === id)!;
}

export async function updateBankAccount(staff: StaffContext, id: string, input: Partial<BankAccountInput> & { reason: string }, now = new Date()): Promise<BankAccountStaffView> {
  const reason = why(input.reason);
  const values = cleanAccount({ ...input, reason: undefined } as Partial<BankAccountInput>, true);
  if (!Object.keys(values).length) throw errors.validation({ account: ['nothing to change'] });
  try {
    await unsafeAdminDb().transaction(async (tx) => {
      const [before] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, id)).for('update').limit(1);
      if (!before) throw errors.notFound('bank account');
      await tx.update(bankAccounts).set({ ...values, updatedAt: now }).where(eq(bankAccounts.id, id));
      const changed = Object.fromEntries(Object.keys(values).map((k) => [k, { from: (before as Record<string, unknown>)[k] ?? null, to: (values as Record<string, unknown>)[k] }]));
      await staffLog(staff, { action: 'bank_account.update', targetType: 'bank_account', targetId: id, reason, detail: changed }, tx as unknown as Db);
    });
  } catch (e) {
    if (isUnique(e)) throw errors.validation(DUPLICATE_IBAN);
    throw e;
  }
  return (await paymentSettingsForStaff()).accounts.find((a) => a.id === id)!;
}

/** Deleted only if no transfer ever named it; otherwise switch it off instead. */
export async function deleteBankAccount(staff: StaffContext, id: string, reason: string): Promise<void> {
  const why_ = why(reason);
  await unsafeAdminDb().transaction(async (tx) => {
    const [account] = await tx.select().from(bankAccounts).where(eq(bankAccounts.id, id)).for('update').limit(1);
    if (!account) throw errors.notFound('bank account');
    const [named] = await tx.select({ id: bankTransferRequests.id }).from(bankTransferRequests).where(eq(bankTransferRequests.bankAccountId, id)).limit(1);
    if (named) throw errors.conflict('transfers name this account — switch it off instead of deleting it');
    await tx.delete(bankAccounts).where(eq(bankAccounts.id, id));
    await staffLog(staff, { action: 'bank_account.delete', targetType: 'bank_account', targetId: id, reason: why_, detail: { bankName: account.bankName, iban: account.iban } }, tx as unknown as Db);
  });
}
