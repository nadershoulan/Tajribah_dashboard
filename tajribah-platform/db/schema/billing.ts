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
import { index, integer, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { amountMinor, bool, createdAt, currency, json, pk, tenantId, timestamps, ts } from './_shared';
import { tenants } from './identity';

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
}, (t) => [index('credit_ledger_tenant_idx').on(t.tenantId, t.createdAt)]);

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

export type Plan = typeof plans.$inferSelect;
export type Subscription = typeof subscriptions.$inferSelect;
export type Invoice = typeof invoices.$inferSelect;
