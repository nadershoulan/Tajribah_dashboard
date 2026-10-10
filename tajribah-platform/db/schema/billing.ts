/**
 * §7.4 — plans, subscriptions, invoices, credits.
 *
 * Three rules encoded here rather than remembered:
 *  1. `credit_ledger` is append-only. A balance is the sum of deltas; `balance_after` is a
 *     convenience written in the same transaction, never an authority.
 *  2. `billing_events.provider_event_id` is UNIQUE. Every webhook inserts there *first*, so
 *     a duplicate delivery fails the insert and the handler exits having changed nothing.
 *     That is what makes double-charging structurally impossible.
 *  3. Invoice numbers are gapless per tenant per year (ZATCA). Allocated from
 *     `invoice_sequences` inside the invoice transaction — never `count(*) + 1`.
 *
 * Money is integer halalas plus a currency (T5).
 */
import { sql } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { amountMinor, bool, createdAt, currency, json, pk, tenantId, timestamps, ts } from './_shared';
import { tenants } from './identity';
// Relative, as in _shared.ts: drizzle-kit loads the schema outside the bundler.
import { TRANSFER_EVENTS, TRANSFER_STATUSES } from '../../lib/contracts/bank-transfer';

export const PLAN_CODE = ['starter', 'growth', 'pro', 'enterprise'] as const;
export const SUBSCRIPTION_STATUS = ['trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired'] as const;
export const INVOICE_STATUS = ['draft', 'issued', 'paid', 'void', 'refunded'] as const;
export const PAYMENT_STATUS = ['initiated', 'authorized', 'captured', 'failed', 'refunded'] as const;

/** Quota keys. `-1` in `plan_limits.value` means unlimited. */
export const LIMIT_KEY = ['products', 'ai_credits', 'storage_gb', 'ar_sessions', 'team_members', 'bandwidth_gb'] as const;
export type LimitKey = (typeof LIMIT_KEY)[number];

export const planCode = pgEnum('plan_code', PLAN_CODE);
export const subscriptionStatus = pgEnum('subscription_status', SUBSCRIPTION_STATUS);
export const invoiceStatus = pgEnum('invoice_status', INVOICE_STATUS);
export const paymentStatus = pgEnum('payment_status', PAYMENT_STATUS);
export const limitKey = pgEnum('limit_key', LIMIT_KEY);
export const billingCycle = pgEnum('billing_cycle', ['monthly', 'annual']);
export const paymentMethodKind = pgEnum('payment_method_kind', ['mada', 'card', 'applepay', 'stcpay', 'bank_transfer']);
export const creditReason = pgEnum('credit_reason', ['purchase', 'plan_grant', 'consumption', 'refund', 'adjustment', 'expiry']);
export const changeType = pgEnum('subscription_change_type', ['upgrade', 'downgrade', 'cycle_change', 'cancel', 'resume']);
export const zatcaStatus = pgEnum('zatca_status', ['pending', 'reported', 'cleared', 'failed']);

export const plans = pgTable('plans', {
  id: pk(),
  code: planCode('code').notNull(),
  name: text('name').notNull(),
  nameAr: text('name_ar').notNull(),
  /** Null = no list price ("talk to us", Enterprise) — never a made-up 0 (P2.1, drizzle/0006). */
  priceMonthlyMinor: integer('price_monthly_minor'),
  priceAnnualMinor: integer('price_annual_minor'),
  currency: currency(),
  isPublic: bool('is_public').notNull().default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps(),
}, (t) => [uniqueIndex('plans_code_unq').on(t.code)]);

export const planLimits = pgTable('plan_limits', {
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  key: limitKey('key').notNull(),
  value: integer('value').notNull(),
}, (t) => [primaryKey({ columns: [t.planId, t.key] })]);

export const planFeatures = pgTable('plan_features', {
  planId: uuid('plan_id').notNull().references(() => plans.id, { onDelete: 'cascade' }),
  featureKey: text('feature_key').notNull(),
  enabled: bool('enabled').notNull().default(true),
}, (t) => [primaryKey({ columns: [t.planId, t.featureKey] })]);

export const subscriptions = pgTable('subscriptions', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  planId: uuid('plan_id').notNull().references(() => plans.id),
  status: subscriptionStatus('status').notNull().default('trialing'),
  billingCycle: billingCycle('billing_cycle').notNull().default('monthly'),
  currentPeriodStart: ts('current_period_start').notNull(),
  currentPeriodEnd: ts('current_period_end').notNull(),
  cancelAtPeriodEnd: bool('cancel_at_period_end').notNull().default(false),
  cancelledAt: ts('cancelled_at'),
  provider: text('provider').notNull().default('none'),
  providerSubscriptionId: text('provider_subscription_id'),
  ...timestamps(),
}, (t) => [index('subscriptions_tenant_idx').on(t.tenantId, t.status)]);

/** Append-only history of plan moves; proration is evidence, not a recomputation. */
export const subscriptionChanges = pgTable('subscription_changes', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  subscriptionId: uuid('subscription_id').notNull().references(() => subscriptions.id, { onDelete: 'cascade' }),
  fromPlanId: uuid('from_plan_id'),
  toPlanId: uuid('to_plan_id').notNull(),
  changeType: changeType('change_type').notNull(),
  prorationMinor: integer('proration_minor').notNull().default(0),
  effectiveAt: ts('effective_at').notNull(),
  createdBy: uuid('created_by'),
  createdAt: createdAt(),
}, (t) => [index('sub_changes_sub_idx').on(t.subscriptionId)]);

/** One gapless sequence per tenant per year (ZATCA). Incremented inside the invoice transaction. */
export const invoiceSequences = pgTable('invoice_sequences', {
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  year: integer('year').notNull(),
  nextNumber: integer('next_number').notNull().default(1),
}, (t) => [primaryKey({ columns: [t.tenantId, t.year] })]);

export const invoices = pgTable('invoices', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  invoiceNumber: text('invoice_number').notNull(),
  subscriptionId: uuid('subscription_id'),
  status: invoiceStatus('status').notNull().default('draft'),
  subtotalMinor: amountMinor('subtotal_minor'),
  vatRateBp: integer('vat_rate_bp').notNull().default(1500), // basis points: 1500 = 15%
  vatMinor: amountMinor('vat_minor'),
  totalMinor: amountMinor('total_minor'),
  currency: currency(),
  issuedAt: ts('issued_at'),
  dueAt: ts('due_at'),
  paidAt: ts('paid_at'),
  pdfStorageKey: text('pdf_storage_key'),
  // ZATCA Phase 2 fields, filled by the certified provider — never computed here (§5).
  zatcaUuid: text('zatca_uuid'),
  zatcaHash: text('zatca_hash'),
  zatcaQr: text('zatca_qr'),
  zatcaStatus: zatcaStatus('zatca_status'),
  buyerVatNumber: text('buyer_vat_number'),
  buyerCrNumber: text('buyer_cr_number'),
  // P2.6 (drizzle/0008): both parties as they were at issue — an invoice never changes afterwards.
  sellerName: text('seller_name'),
  sellerNameAr: text('seller_name_ar'),
  sellerCrNumber: text('seller_cr_number'),
  sellerVatNumber: text('seller_vat_number'),
  sellerAddress: text('seller_address'),
  /** drizzle/0013: the seller's address in Arabic, as issued. */
  sellerAddressAr: text('seller_address_ar'),
  buyerName: text('buyer_name'),
  buyerNameAr: text('buyer_name_ar'),
  buyerAddress: text('buyer_address'),
  ...timestamps(),
}, (t) => [
  uniqueIndex('invoices_number_unq').on(t.invoiceNumber),
  index('invoices_tenant_idx').on(t.tenantId, t.status, t.issuedAt),
]);

export const invoiceLines = pgTable('invoice_lines', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  invoiceId: uuid('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  description: text('description').notNull(),
  descriptionAr: text('description_ar'),
  quantity: integer('quantity').notNull().default(1),
  unitPriceMinor: amountMinor('unit_price_minor'),
  amountMinor: amountMinor('amount_minor'),
  taxMinor: amountMinor('tax_minor'),
}, (t) => [index('invoice_lines_invoice_idx').on(t.invoiceId)]);

export const payments = pgTable('payments', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  invoiceId: uuid('invoice_id'),
  amountMinor: amountMinor('amount_minor'),
  currency: currency(),
  status: paymentStatus('status').notNull().default('initiated'),
  method: paymentMethodKind('method'),
  provider: text('provider').notNull().default('moyasar'),
  providerPaymentId: text('provider_payment_id'),
  failureCode: text('failure_code'),
  /** Client-supplied; a retry with the same key must not create a second charge. */
  idempotencyKey: text('idempotency_key'),
  rawResponse: json<Record<string, unknown>>('raw_response'),
  ...timestamps(),
}, (t) => [
  uniqueIndex('payments_provider_id_unq').on(t.providerPaymentId),
  uniqueIndex('payments_idempotency_unq').on(t.idempotencyKey),
  index('payments_tenant_idx').on(t.tenantId, t.status),
]);

/** APPEND ONLY. Never update a row here; write a compensating delta instead. */
export const creditLedger = pgTable('credit_ledger', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  delta: integer('delta').notNull(),
  balanceAfter: integer('balance_after').notNull(),
  reason: creditReason('reason').notNull(),
  referenceType: text('reference_type'),
  referenceId: uuid('reference_id'),
  note: text('note'),
  createdAt: createdAt(),
}, (t) => [
  index('credit_ledger_tenant_idx').on(t.tenantId, t.createdAt),
  // P2.9 (drizzle/0009): one row per reference — a retried job, grant or refund is a no-op.
  uniqueIndex('credit_ledger_reference_unq').on(t.tenantId, t.referenceType, t.referenceId).where(sql`${t.referenceId} is not null`),
]);

export const usageCounters = pgTable('usage_counters', {
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  periodStart: ts('period_start').notNull(),
  metric: limitKey('metric').notNull(),
  value: integer('value').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.periodStart, t.metric] })]);

/**
 * Webhook idempotency for every payment provider. The unique constraint is the mechanism —
 * insert first, process second.
 */
export const billingEvents = pgTable('billing_events', {
  id: pk(),
  provider: text('provider').notNull(),
  providerEventId: text('provider_event_id').notNull(),
  eventType: text('event_type').notNull(),
  payload: json<Record<string, unknown>>('payload'),
  processedAt: ts('processed_at'),
  error: text('error'),
  createdAt: createdAt(),
}, (t) => [uniqueIndex('billing_events_provider_event_unq').on(t.provider, t.providerEventId)]);

/**
 * P2.12 (drizzle/0010) — a coupon: a percentage, a fixed amount, or free months. Platform
 * catalogue, read-only to the app (the admin console writes it). Codes are stored upper-case.
 * `applies_to` null = every plan; `max_redemptions` null = no limit.
 */
export const couponKind = pgEnum('coupon_kind', ['percent', 'fixed', 'free_months']);

export const coupons = pgTable('coupons', {
  id: pk(),
  code: text('code').notNull(),
  kind: couponKind('kind').notNull(),
  percentOff: integer('percent_off'),
  amountOffMinor: integer('amount_off_minor'),
  freeMonths: integer('free_months'),
  appliesTo: json<(typeof PLAN_CODE)[number][]>('applies_to'),
  maxRedemptions: integer('max_redemptions'),
  validFrom: ts('valid_from'),
  validUntil: ts('valid_until'),
  active: bool('active').notNull().default(true),
  note: text('note'),
  ...timestamps(),
}, (t) => [uniqueIndex('coupons_code_unq').on(t.code)]);

/** One per store per coupon: the unique index is what stops a second use. */
export const couponRedemptions = pgTable('coupon_redemptions', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  couponId: uuid('coupon_id').notNull().references(() => coupons.id, { onDelete: 'restrict' }),
  subscriptionId: uuid('subscription_id'),
  invoiceId: uuid('invoice_id'),
  discountMinor: integer('discount_minor').notNull().default(0),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('coupon_redemptions_once_unq').on(t.couponId, t.tenantId),
  index('coupon_redemptions_tenant_idx').on(t.tenantId),
]);

/**
 * T129 (drizzle/0047) — how stores may pay, set by staff in the admin console («طرق الدفع»). One row per method key
 * of `lib/payment-methods.ts` (the registry says which methods exist and which are ready to take money; this row
 * says whether staff offer it, in what order, and its own settings — bank transfer's grace days, reminders,
 * instructions). Platform data: the admin role writes it, the server reads it through the admin role.
 */
export const paymentMethodSettings = pgTable('payment_method_settings', {
  key: text('key').primaryKey(),
  enabled: bool('enabled').default(false),
  sortOrder: integer('sort_order').notNull().default(0),
  config: json<Record<string, unknown>>('config'),
  updatedBy: uuid('updated_by'),
  ...timestamps(),
});

/**
 * T129 — Tajribah's own bank accounts that stores transfer to. Staff add and edit them; the IBAN is checked (mod 97)
 * before it is saved. An account a transfer named is never deleted, only switched off — the transfer keeps a
 * snapshot of what the store was shown either way.
 */
export const bankAccounts = pgTable('bank_accounts', {
  id: pk(),
  bankName: text('bank_name').notNull(),
  bankNameAr: text('bank_name_ar').notNull(),
  /** The account's name exactly as the bank writes it — what the store's bank shows before it sends. */
  accountHolder: text('account_holder').notNull(),
  accountNumber: text('account_number').notNull(),
  iban: text('iban').notNull(),
  swift: text('swift'),
  currency: currency(),
  active: bool('active').default(true),
  sortOrder: integer('sort_order').notNull().default(0),
  /** For staff only (which branch, who manages it); never shown to a store. */
  note: text('note'),
  ...timestamps(),
}, (t) => [uniqueIndex('bank_accounts_iban_unq').on(t.iban)]);

export const transferStatus = pgEnum('bank_transfer_status', TRANSFER_STATUSES);
export const transferEventType = pgEnum('bank_transfer_event', TRANSFER_EVENTS);

export type BankSnapshot = { bankName: string; bankNameAr: string; accountHolder: string; accountNumber: string; iban: string };

/**
 * T129 — a store asking for a plan paid by bank transfer: what it chose, the amounts it was quoted (kept as quoted —
 * a later price change never changes what it paid for), the account it was shown, who sent the money, the receipt,
 * and staff's decision. **One open request per store** (pending, or waiting for more from the store): the partial
 * unique index is the guarantee, not a check in code. Approval issues the invoice and the payment and fills
 * `invoice_id`, `payment_id` and the period granted, in the same transaction.
 */
export const bankTransferRequests = pgTable('bank_transfer_requests', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  reference: text('reference').notNull(),
  status: transferStatus('status').notNull().default('pending'),
  planId: uuid('plan_id').notNull().references(() => plans.id),
  planCode: planCode('plan_code').notNull(),
  billingCycle: billingCycle('billing_cycle').notNull(),
  unitPriceMinor: amountMinor('unit_price_minor'),
  discountMinor: integer('discount_minor').notNull().default(0),
  couponCode: text('coupon_code'),
  freeMonths: integer('free_months').notNull().default(0),
  couponRedemptionId: uuid('coupon_redemption_id'),
  subtotalMinor: amountMinor('subtotal_minor'),
  vatMinor: amountMinor('vat_minor'),
  totalMinor: amountMinor('total_minor'),
  currency: currency(),
  bankAccountId: uuid('bank_account_id').notNull().references(() => bankAccounts.id, { onDelete: 'restrict' }),
  bankSnapshot: json<BankSnapshot>('bank_snapshot').notNull(),
  senderName: text('sender_name').notNull(),
  senderBank: text('sender_bank'),
  /** The day the store says it sent the money, `YYYY-MM-DD`. */
  transferredOn: text('transferred_on'),
  receiptKey: text('receipt_key'),
  receiptType: text('receipt_type'),
  receiptBytes: integer('receipt_bytes'),
  receiptName: text('receipt_name'),
  /** Bought for a company: these go on the invoice as the buyer. */
  buyerCompany: bool('buyer_company').default(false),
  buyerName: text('buyer_name'),
  buyerVatNumber: text('buyer_vat_number'),
  buyerCrNumber: text('buyer_cr_number'),
  merchantNote: text('merchant_note'),
  /** Staff's words to the store: why it was declined, or what more is needed. */
  decisionMessage: text('decision_message'),
  /** Staff's own note; never shown to the store. */
  staffNote: text('staff_note'),
  decidedBy: uuid('decided_by'),
  decidedAt: ts('decided_at'),
  submittedBy: uuid('submitted_by').notNull(),
  subscriptionId: uuid('subscription_id'),
  invoiceId: uuid('invoice_id'),
  paymentId: uuid('payment_id'),
  periodStart: ts('period_start'),
  periodEnd: ts('period_end'),
  ...timestamps(),
}, (t) => [
  uniqueIndex('bank_transfer_reference_unq').on(t.reference),
  uniqueIndex('bank_transfer_one_open_unq').on(t.tenantId).where(sql`${t.status} in ('pending', 'info_requested')`),
  index('bank_transfer_status_idx').on(t.status, t.createdAt),
  index('bank_transfer_tenant_idx').on(t.tenantId, t.createdAt),
]);

/**
 * T129 — what happened to a transfer request, in order: submitted, more asked for, sent again, approved, declined,
 * cancelled, a staff note. Append-only (APPEND_ONLY): a timeline the application could rewrite proves nothing.
 * `internal` rows (staff notes) are never shown to the store.
 */
export const bankTransferEvents = pgTable('bank_transfer_events', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  requestId: uuid('request_id').notNull().references(() => bankTransferRequests.id, { onDelete: 'cascade' }),
  type: transferEventType('type').notNull(),
  /** `store`, `staff` or `system`. */
  actorType: text('actor_type').notNull(),
  actorUserId: uuid('actor_user_id'),
  message: text('message'),
  internal: bool('internal').default(false),
  createdAt: createdAt(),
}, (t) => [index('bank_transfer_events_request_idx').on(t.requestId, t.createdAt)]);

export type PaymentMethodSetting = typeof paymentMethodSettings.$inferSelect;
export type BankAccount = typeof bankAccounts.$inferSelect;
export type BankTransferRequest = typeof bankTransferRequests.$inferSelect;
export type BankTransferEvent = typeof bankTransferEvents.$inferSelect;
export type Coupon = typeof coupons.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
