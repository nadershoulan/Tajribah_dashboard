/**
 * T129 — bank transfer, the rules both sides share: the store's checkout and the server (and the tests).
 *
 *  - **IBAN**: the ISO 13616 check (mod 97), and a Saudi IBAN's shape (SA + 22 digits). A wrong digit typed by
 *    staff would send every store's money to the wrong place, so a bank account cannot be saved without passing.
 *  - **The reference** (`TJR-7K3M9Q`): what the store writes in the transfer's note so staff can match the money
 *    on the bank statement. No 0/O or 1/I/L, so it can be read off a statement and typed back.
 *  - **The receipt**: PNG, JPEG, WebP or PDF, judged by the file's own first bytes, never its name or the type
 *    the browser claims; up to 10 MB.
 *  - **The period** a transfer buys: a renewal of the same plan extends from the end of the paid period (no day is
 *    lost by paying early); a different plan starts on approval, and the paid days left on the old plan are carried
 *    over at their value (a store moving up gets fewer, moving down more), so nothing paid for is lost.
 */
import type { Bi } from '../lang';
import type { PlanCode } from '../plans';

export const TRANSFER_STATUSES = ['pending', 'info_requested', 'approved', 'rejected', 'cancelled'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];
/** A store has at most one of these at a time. */
export const OPEN_STATUSES: readonly TransferStatus[] = ['pending', 'info_requested'];
export const isOpen = (status: TransferStatus) => OPEN_STATUSES.includes(status);

export const TRANSFER_STATUS_LABEL: Record<TransferStatus, Bi> = {
  pending: { ar: 'قيد المراجعة', en: 'Under review' },
  info_requested: { ar: 'بانتظار معلومات منك', en: 'Waiting for more from you' },
  approved: { ar: 'مقبول', en: 'Approved' },
  rejected: { ar: 'مرفوض', en: 'Declined' },
  cancelled: { ar: 'ملغى', en: 'Cancelled' },
};

export const TRANSFER_EVENTS = ['submitted', 'info_requested', 'resubmitted', 'approved', 'rejected', 'cancelled', 'note'] as const;
export type TransferEventType = (typeof TRANSFER_EVENTS)[number];

/** Staff's usual reasons for declining, offered as a start; the text the store reads is always staff's own. */
export const REJECTION_PRESETS: { key: string; text: Bi }[] = [
  { key: 'not_received', text: { ar: 'لم يصل المبلغ إلى حسابنا.', en: 'The money has not reached our account.' } },
  { key: 'amount', text: { ar: 'المبلغ المحوّل لا يطابق المطلوب.', en: 'The amount transferred does not match the amount due.' } },
  { key: 'receipt', text: { ar: 'الإيصال غير واضح أو لا يخص هذا التحويل.', en: 'The receipt is unclear or is not for this transfer.' } },
  { key: 'account', text: { ar: 'التحويل إلى حساب غير حساباتنا.', en: 'The transfer went to an account that is not ours.' } },
];

/** One step on a request's timeline, as the store (no internal notes) or staff see it. */
export type TransferEventView = { id: string; type: TransferEventType; actor: 'store' | 'staff' | 'system'; message: string | null; internal: boolean; at: string };

/** A transfer request as the store sees it (staff see the same, plus their notes). */
export type TransferView = {
  id: string; reference: string; status: TransferStatus;
  plan: PlanCode; cycle: 'monthly' | 'annual';
  unitPriceMinor: number; discountMinor: number; couponCode: string | null; freeMonths: number;
  subtotalMinor: number; vatMinor: number; totalMinor: number; currency: string;
  bank: { bankName: string; bankNameAr: string; accountHolder: string; accountNumber: string; iban: string; ibanDisplay: string };
  senderName: string; senderBank: string | null; transferredOn: string | null;
  receipt: { type: string; bytes: number; name: string | null } | null;
  company: { name: string; vatNumber: string | null; crNumber: string | null } | null;
  note: string | null;
  /** Staff's words to the store: why it was declined, or what more is needed. */
  decisionMessage: string | null;
  decidedAt: string | null;
  invoiceId: string | null;
  periodEnd: string | null;
  createdAt: string; updatedAt: string;
  events: TransferEventView[];
};

// ------------------------------------------------------------------ IBAN

/** Spaces and dashes out, upper case: what an IBAN is stored as. */
export const normaliseIban = (iban: string) => iban.replace(/[\s-]/g, '').toUpperCase();

/** ISO 13616: move the first four characters to the end, letters to numbers (A=10…), the result mod 97 is 1. */
export function ibanChecksumOk(iban: string): boolean {
  const s = normaliseIban(iban);
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const moved = s.slice(4) + s.slice(0, 4);
  let rest = 0;
  for (const ch of moved) {
    const v = ch >= 'A' && ch <= 'Z' ? ch.charCodeAt(0) - 55 : Number(ch);
    rest = v >= 10 ? (rest * 100 + v) % 97 : (rest * 10 + v) % 97;
  }
  return rest === 1;
}

/** Null when it is a valid Saudi IBAN, else why not. */
export function ibanProblem(iban: string): string | null {
  const s = normaliseIban(iban);
  if (!/^SA\d{22}$/.test(s)) return 'a Saudi IBAN is SA followed by 22 digits';
  if (!ibanChecksumOk(s)) return 'this IBAN’s check digits do not match — a character is wrong';
  return null;
}

/** `SA03 8000 0000 6080 1016 7519` — read in groups of four (always left to right). */
export const formatIban = (iban: string) => normaliseIban(iban).replace(/(.{4})(?=.)/g, '$1 ');

// ------------------------------------------------------------------ reference

/** Crockford-like: no 0, O, 1, I, L, U — nothing that reads as something else on a statement. */
export const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export const REFERENCE_PATTERN = /^TJR-[23456789ABCDEFGHJKMNPQRSTVWXYZ]{6}$/;

/** A new reference from random bytes (crypto, from the caller): 30^6 ≈ 729 million. */
export function referenceFrom(random: Uint8Array): string {
  if (random.length < 6) throw new Error('six random bytes are needed');
  let out = 'TJR-';
  for (let i = 0; i < 6; i++) out += REFERENCE_ALPHABET[random[i]! % REFERENCE_ALPHABET.length];
  return out;
}

// ------------------------------------------------------------------ receipt

export const RECEIPT_MAX_BYTES = 10 * 1024 * 1024;
export const RECEIPT_MIN_BYTES = 200;
export const RECEIPT_TYPES = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'application/pdf': 'pdf' } as const;
export type ReceiptType = keyof typeof RECEIPT_TYPES;
export const RECEIPT_ACCEPT = 'image/png,image/jpeg,image/webp,application/pdf,.png,.jpg,.jpeg,.webp,.pdf';

/** The type the bytes themselves say, or null. */
export function sniffReceipt(bytes: Uint8Array): ReceiptType | null {
  const at = (i: number, ...v: number[]) => v.every((b, k) => bytes[i + k] === b);
  if (at(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (at(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (at(0, 0x52, 0x49, 0x46, 0x46) && at(8, 0x57, 0x45, 0x42, 0x50)) return 'image/webp';
  if (at(0, 0x25, 0x50, 0x44, 0x46, 0x2d)) return 'application/pdf';
  return null;
}

/** The type a file's name or browser type suggests, for the upload request (the bytes decide later). */
export function receiptTypeOf(file: { name: string; type: string }): ReceiptType | null {
  if (file.type in RECEIPT_TYPES) return file.type as ReceiptType;
  const ext = file.name.toLowerCase().split('.').pop();
  return ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'pdf' ? 'application/pdf' : null;
}

// ------------------------------------------------------------------ the period a transfer buys

const DAY = 86_400_000;

/** `months` calendar months on (UTC), the day held where the month allows: 31 Jan + 1 month is 28/29 Feb. */
export function addMonths(at: Date, months: number): Date {
  const d = new Date(at.getTime());
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export type CurrentSubscription = {
  planCode: string;
  status: 'trialing' | 'active' | 'past_due' | 'paused' | 'cancelled' | 'expired';
  periodStart: Date;
  periodEnd: Date;
  /** What one month of the current plan is worth (halalas), for carrying days over; null = no list price. */
  monthlyMinor: number | null;
};

export type PeriodPlan = {
  start: Date;
  end: Date;
  /** Same plan, still paid: the new time is added at the end of what is left. */
  extends: boolean;
  /** Days carried over from the old plan (a change of plan with paid time left). */
  carriedDays: number;
};

/**
 * The period a transfer approved at `now` buys: `cycle` (one month or a year) plus any free months from a coupon.
 * See the file comment for the three cases.
 */
export function periodFor(input: {
  now: Date; current: CurrentSubscription | null; planCode: string; cycle: 'monthly' | 'annual'; freeMonths?: number;
  /** One month of the new plan (halalas), for carrying days over. */
  newMonthlyMinor: number | null;
}): PeriodPlan {
  const months = (input.cycle === 'annual' ? 12 : 1) + Math.max(0, Math.floor(input.freeMonths ?? 0));
  const cur = input.current;
  const paid = !!cur && (cur.status === 'active' || cur.status === 'past_due') && cur.periodEnd.getTime() > input.now.getTime();
  if (paid && cur.planCode === input.planCode) {
    return { start: cur.periodStart, end: addMonths(cur.periodEnd, months), extends: true, carriedDays: 0 };
  }
  const end = addMonths(input.now, months);
  if (paid && cur.monthlyMinor && input.newMonthlyMinor) {
    const leftMs = cur.periodEnd.getTime() - input.now.getTime();
    const carried = Math.floor((leftMs * cur.monthlyMinor) / input.newMonthlyMinor / DAY);
    return { start: input.now, end: new Date(end.getTime() + carried * DAY), extends: false, carriedDays: carried };
  }
  return { start: input.now, end, extends: false, carriedDays: 0 };
}
