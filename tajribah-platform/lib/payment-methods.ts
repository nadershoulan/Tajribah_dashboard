/**
 * T129 — the ways a store can pay for its subscription, as one registry shared by the checkout, the staff
 * console and the server.
 *
 * A method has two switches that mean different things:
 *  - **ready** (here, in code): Tajribah can actually take money this way. Bank transfer is ready today (staff
 *    check the transfer by hand). The card, mada, Apple Pay, STC Bank, Tamara and Tabby methods need their payment
 *    gateway wired first (P2.3, Moyasar; Tamara and Tabby have their own) — until then they are listed for staff,
 *    and cannot be switched on.
 *  - **enabled** (in the database, `payment_method_settings`): staff offer it to stores, or not, from the console
 *    («طرق الدفع»). Only a method that is both ready and enabled reaches a checkout.
 *
 * **A new method** is one entry here (and, when it takes money online, its gateway): the console lists it, staff
 * switch it on, the checkout shows it. Nothing else changes.
 */
import type { Bi } from './lang';

export const PAYMENT_METHOD_KEYS = ['bank_transfer', 'mada', 'card', 'applepay', 'stcpay', 'tamara', 'tabby'] as const;
export type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];

export type PaymentMethodInfo = {
  key: PaymentMethodKey;
  /** offline: staff confirm the money by hand (bank transfer). online: a gateway charges and confirms. */
  kind: 'offline' | 'online';
  label: Bi;
  /** One line under the name at checkout. */
  blurb: Bi;
  /** Who takes the money; null for an offline method. */
  provider: 'moyasar' | 'tamara' | 'tabby' | null;
  /** True once Tajribah can take money this way (see the file comment). */
  ready: boolean;
};

export const PAYMENT_METHODS: readonly PaymentMethodInfo[] = [
  {
    key: 'bank_transfer', kind: 'offline', provider: null, ready: true,
    label: { ar: 'تحويل بنكي', en: 'Bank transfer' },
    blurb: { ar: 'حوّل المبلغ إلى حسابنا وأرفق الإيصال؛ نفعّل اشتراكك بعد التحقق.', en: 'Transfer the amount to our account and attach the receipt; we switch your plan on once it is checked.' },
  },
  {
    key: 'mada', kind: 'online', provider: 'moyasar', ready: false,
    label: { ar: 'مدى', en: 'mada' },
    blurb: { ar: 'بطاقة مدى البنكية.', en: 'A mada debit card.' },
  },
  {
    key: 'card', kind: 'online', provider: 'moyasar', ready: false,
    label: { ar: 'فيزا / ماستركارد', en: 'Visa / Mastercard' },
    blurb: { ar: 'بطاقة ائتمانية أو مسبقة الدفع.', en: 'A credit or prepaid card.' },
  },
  {
    key: 'applepay', kind: 'online', provider: 'moyasar', ready: false,
    label: { ar: 'Apple Pay', en: 'Apple Pay' },
    blurb: { ar: 'من جهاز Apple.', en: 'From an Apple device.' },
  },
  {
    key: 'stcpay', kind: 'online', provider: 'moyasar', ready: false,
    label: { ar: 'STC Bank', en: 'STC Bank' },
    blurb: { ar: 'من محفظة STC Bank.', en: 'From an STC Bank wallet.' },
  },
  {
    key: 'tamara', kind: 'online', provider: 'tamara', ready: false,
    label: { ar: 'تمارا', en: 'Tamara' },
    blurb: { ar: 'قسّمها على دفعات.', en: 'Split it into instalments.' },
  },
  {
    key: 'tabby', kind: 'online', provider: 'tabby', ready: false,
    label: { ar: 'تابي', en: 'Tabby' },
    blurb: { ar: 'قسّمها على دفعات.', en: 'Split it into instalments.' },
  },
];

export const paymentMethod = (key: string): PaymentMethodInfo | undefined => PAYMENT_METHODS.find((m) => m.key === key);
export const isPaymentMethodKey = (key: string): key is PaymentMethodKey => (PAYMENT_METHOD_KEYS as readonly string[]).includes(key);

/** One of Tajribah's bank accounts as a store is shown it. */
export type BankAccountView = {
  id: string; bankName: string; bankNameAr: string; accountHolder: string; accountNumber: string; iban: string;
  ibanDisplay: string; swift: string | null; currency: string; active: boolean; sortOrder: number;
};

/** What a store's checkout may offer: the methods on, in order; bank transfer with its accounts and settings. */
export type CheckoutOptions = {
  methods: PaymentMethodKey[];
  bankTransfer: { accounts: BankAccountView[]; config: Pick<BankTransferConfig, 'receiptRequired' | 'reviewHours' | 'instructions'> } | null;
};

/** Bank transfer's own settings, kept with its row; every field has a default, so an empty row works. */
export type BankTransferConfig = {
  /** Days a store keeps working after its paid period ends before it becomes read-only (it is "past due" meanwhile). */
  graceDays: number;
  /** Days before the period ends when the store is reminded to renew (each once). */
  reminderDays: number[];
  /** Whether a receipt must be attached. */
  receiptRequired: boolean;
  /** What the store is told about review time, in hours. */
  reviewHours: number;
  /** Extra addresses told about each new transfer, besides Tajribah's staff accounts. */
  notifyEmails: string[];
  /** Shown above the bank details at checkout (optional). */
  instructions: Bi | null;
};

export const BANK_TRANSFER_DEFAULTS: BankTransferConfig = {
  graceDays: 7, reminderDays: [7, 2], receiptRequired: true, reviewHours: 24, notifyEmails: [], instructions: null,
};

/** A stored config read safely: unknown or out-of-range values fall back to the defaults. */
export function bankTransferConfig(raw: unknown): BankTransferConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi ? v : d);
  const days = Array.isArray(r.reminderDays)
    ? [...new Set(r.reminderDays.filter((d): d is number => typeof d === 'number' && Number.isInteger(d) && d >= 1 && d <= 30))].sort((a, b) => b - a).slice(0, 4)
    : BANK_TRANSFER_DEFAULTS.reminderDays;
  const emails = Array.isArray(r.notifyEmails) ? r.notifyEmails.filter((e): e is string => typeof e === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e)).slice(0, 10) : [];
  const ins = r.instructions as Record<string, unknown> | null | undefined;
  const instructions = ins && typeof ins.ar === 'string' && typeof ins.en === 'string' && (ins.ar.trim() || ins.en.trim())
    ? { ar: ins.ar.trim().slice(0, 1000), en: ins.en.trim().slice(0, 1000) } : null;
  return {
    graceDays: int(r.graceDays, 0, 30, BANK_TRANSFER_DEFAULTS.graceDays),
    reminderDays: days,
    receiptRequired: typeof r.receiptRequired === 'boolean' ? r.receiptRequired : BANK_TRANSFER_DEFAULTS.receiptRequired,
    reviewHours: int(r.reviewHours, 1, 240, BANK_TRANSFER_DEFAULTS.reviewHours),
    notifyEmails: emails,
    instructions,
  };
}
