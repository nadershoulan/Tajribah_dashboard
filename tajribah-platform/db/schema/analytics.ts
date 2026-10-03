/**
 * §7.10 — analytics.
 *
 * ClickHouse-shaped on purpose: the column list, the types and the rollup grain match the
 * plan's DDL, so moving to ClickHouse is an exporter rather than a rewrite (D5). Until the
 * volume demands it, these live in Postgres — **partitioned by month**, and never read by a
 * merchant screen. Dashboards read the rollup tables only.
 *
 * Privacy is structural, not a policy note: no IP addresses, no raw user agents, no
 * cross-site identifiers, no shopper identity. `session_id` is a salted hash rotated every
 * 24 hours, which makes it useless for following a person across days — deliberately.
 */
import { index, integer, pgEnum, pgTable, primaryKey, text, uniqueIndex, uuid, date, bigint } from 'drizzle-orm/pg-core';
import { json, pk, tenantId, ts } from './_shared';
import { tenants } from './identity';
import { products } from './commerce';

export const EVENT_TYPE = [
  'product_view', 'ar_open', 'ar_place', 'ar_close',
  'tryon_start', 'tryon_capture', 'tryon_share',
  'add_to_cart', 'purchase',
] as const;

export type EventType = (typeof EVENT_TYPE)[number];

export const eventType = pgEnum('event_type', EVENT_TYPE);
export const deviceType = pgEnum('device_type', ['mobile', 'tablet', 'desktop', 'unknown']);

export const analyticsEvents = pgTable('analytics_events', {
  id: pk(),
  tenantId: uuid('tenant_id').notNull(),
  eventType: eventType('event_type').notNull(),
  productId: uuid('product_id'),
  /** Salted daily, not an identity. */
  sessionId: text('session_id').notNull(),
  occurredAt: ts('occurred_at').notNull(),
  deviceType: deviceType('device_type').notNull().default('unknown'),
  os: text('os'),
  browser: text('browser'),
  country: text('country'),
  region: text('region'),
  referrerHost: text('referrer_host'),
  arSupported: integer('ar_supported').notNull().default(0),
  durationMs: integer('duration_ms'),
  /** Order value in minor units, on purchase events only. */
  valueMinor: bigint('value_minor', { mode: 'number' }),
  currency: text('currency'),
  properties: json<Record<string, string>>('properties'),
}, (t) => [
  index('events_tenant_type_time_idx').on(t.tenantId, t.eventType, t.occurredAt),
  index('events_session_idx').on(t.sessionId),
  /** 0034: one store's day, whatever the event — what the roll-up and the live view read. */
  index('events_tenant_time_idx').on(t.tenantId, t.occurredAt),
]);

/** Rollups are what the dashboard reads. Retained indefinitely; raw events expire at 90 days. */
export const dailyProductStats = pgTable('daily_product_stats', {
  tenantId: uuid('tenant_id').notNull(),
  productId: uuid('product_id').notNull(),
  day: date('day').notNull(), // calendar day in Asia/Riyadh
  views: integer('views').notNull().default(0),
  arSessions: integer('ar_sessions').notNull().default(0),
  tryonSessions: integer('tryon_sessions').notNull().default(0),
  addToCart: integer('add_to_cart').notNull().default(0),
  purchases: integer('purchases').notNull().default(0),
  revenueMinor: bigint('revenue_minor', { mode: 'number' }).notNull().default(0),
  avgArDurationMs: integer('avg_ar_duration_ms').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.productId, t.day] })]);

export const dailyTenantStats = pgTable('daily_tenant_stats', {
  tenantId: uuid('tenant_id').notNull(),
  day: date('day').notNull(),
  views: integer('views').notNull().default(0),
  arSessions: integer('ar_sessions').notNull().default(0),
  tryonSessions: integer('tryon_sessions').notNull().default(0),
  addToCart: integer('add_to_cart').notNull().default(0),
  purchases: integer('purchases').notNull().default(0),
  revenueMinor: bigint('revenue_minor', { mode: 'number' }).notNull().default(0),
  uniqueSessions: integer('unique_sessions').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.day] })]);

/**
 * The commercially important table (§P4): conversion with AR/try-on against conversion
 * without it, per product per day. "Conversion uplift" is the number merchants renew for,
 * so it is stored, not computed on the fly from two ad-hoc queries.
 */
export const conversionDaily = pgTable('conversion_daily', {
  tenantId: uuid('tenant_id').notNull(),
  productId: uuid('product_id').notNull(),
  day: date('day').notNull(),
  sessionsWithAr: integer('sessions_with_ar').notNull().default(0),
  purchasesWithAr: integer('purchases_with_ar').notNull().default(0),
  sessionsWithoutAr: integer('sessions_without_ar').notNull().default(0),
  purchasesWithoutAr: integer('purchases_without_ar').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.productId, t.day] })]);

export const deviceBreakdownDaily = pgTable('device_breakdown_daily', {
  tenantId: uuid('tenant_id').notNull(),
  day: date('day').notNull(),
  deviceType: deviceType('device_type').notNull(),
  sessions: integer('sessions').notNull().default(0),
  arSupported: integer('ar_supported').notNull().default(0),
}, (t) => [primaryKey({ columns: [t.tenantId, t.day, t.deviceType] })]);

export type AnalyticsEvent = typeof analyticsEvents.$inferSelect;
export type DailyTenantStat = typeof dailyTenantStats.$inferSelect;

/**
 * Recommendations, first version (0038, no AI — your choice 2026-10-03): products often viewed
 * together. Each product's top four by visits that looked at both (a view, AR or the try-on) in the
 * last 30 days, at least three such visits; recomputed nightly, whole, from `analytics_events`.
 */
export const productRelations = pgTable('product_relations', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  relatedProductId: uuid('related_product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  sessions: integer('sessions').notNull(),
  rank: integer('rank').notNull(),
  computedAt: ts('computed_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('product_relations_pair_unq').on(t.productId, t.relatedProductId),
  index('product_relations_tenant_idx').on(t.tenantId, t.productId, t.rank),
]);

/** When each store's relations were last computed (the Riyadh day), so the nightly pass runs once a day. */
export const relationRuns = pgTable('relation_runs', {
  tenantId: tenantId().primaryKey().references(() => tenants.id, { onDelete: 'cascade' }),
  day: date('day').notNull(),
  pairs: integer('pairs').notNull().default(0),
  computedAt: ts('computed_at').notNull().defaultNow(),
});
