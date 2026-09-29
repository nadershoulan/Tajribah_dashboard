/**
 * §7.5 store connections + §7.6 catalogue.
 *
 * Provider tokens are encrypted at rest with AES-256-GCM (`ENCRYPTION_KEY`): never stored
 * plaintext, never logged, never returned by any endpoint.
 *
 * `webhook_events` carries the dedup constraint that makes replay safe: a delivery is
 * stored once, and replay is a status change on that row — not a second processing path.
 * A delivery whose signature fails is refused and not stored at all (DECISIONS T13).
 *
 * `sync_job_items` grows per event rather than per entity, so it is partitioned by month
 * (§7.11) — by `drizzle/0002_partition_sync_job_items.sql`, not by Drizzle, which cannot
 * declare partitions. In the database its primary key is `(id, created_at)`; the `pk()`
 * below is what Drizzle needs to address rows, and `id` is still unique in practice (uuid v7).
 * Monthly partitions are created ahead by the sync schedule (`ensureSyncItemPartitions`).
 */
import { index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bool, createdAt, deletedAt, json, pk, tenantId, timestamps, ts } from './_shared';
import { tenants, productCategory } from './identity';

export const PROVIDER = ['salla', 'zid', 'shopify', 'woocommerce'] as const;
export const CONNECTION_STATUS = ['active', 'expired', 'revoked', 'error'] as const;
export const SYNC_TYPE = ['full', 'incremental', 'single_product', 'inventory', 'orders'] as const;
export const JOB_STATUS = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;
export const PRODUCT_STATUS = ['active', 'draft', 'archived'] as const;

export type Provider = (typeof PROVIDER)[number];

export const provider = pgEnum('provider', PROVIDER);
export const connectionStatus = pgEnum('connection_status', CONNECTION_STATUS);
export const syncType = pgEnum('sync_type', SYNC_TYPE);
export const jobStatus = pgEnum('job_status', JOB_STATUS);
export const productStatus = pgEnum('product_status', PRODUCT_STATUS);
export const syncItemAction = pgEnum('sync_item_action', ['created', 'updated', 'skipped', 'failed']);
export const webhookStatus = pgEnum('webhook_status', ['received', 'processed', 'failed', 'ignored']);
export const syncTrigger = pgEnum('sync_trigger', ['schedule', 'user', 'webhook', 'system']);

export const storeConnections = pgTable('store_connections', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  provider: provider('provider').notNull(),
  externalStoreId: text('external_store_id').notNull(),
  storeName: text('store_name'),
  storeUrl: text('store_url'),
  accessTokenEncrypted: text('access_token_encrypted'),
  refreshTokenEncrypted: text('refresh_token_encrypted'),
  tokenExpiresAt: ts('token_expires_at'),
  scopes: json<string[]>('scopes'),
  status: connectionStatus('status').notNull().default('active'),
  lastSyncAt: ts('last_sync_at'),
  syncIntervalMinutes: integer('sync_interval_minutes').notNull().default(60),
  lastError: text('last_error'),
  /** 0–100, decayed by failures. Drives the connection health badge in the UI. */
  healthScore: integer('health_score').notNull().default(100),
  settings: json<Record<string, unknown>>('settings'),
  ...timestamps(),
}, (t) => [
  uniqueIndex('connections_provider_store_unq').on(t.provider, t.externalStoreId),
  index('connections_tenant_idx').on(t.tenantId, t.status),
]);

export const syncJobs = pgTable('sync_jobs', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').notNull().references(() => storeConnections.id, { onDelete: 'cascade' }),
  type: syncType('type').notNull(),
  status: jobStatus('status').notNull().default('queued'),
  /** Opaque provider cursor — this is what makes a sync resumable rather than restartable. */
  cursor: text('cursor'),
  totalItems: integer('total_items').notNull().default(0),
  processedItems: integer('processed_items').notNull().default(0),
  failedItems: integer('failed_items').notNull().default(0),
  startedAt: ts('started_at'),
  finishedAt: ts('finished_at'),
  error: text('error'),
  triggeredBy: syncTrigger('triggered_by').notNull().default('schedule'),
  ...timestamps(),
}, (t) => [
  index('sync_jobs_tenant_idx').on(t.tenantId, t.status, t.createdAt),
  index('sync_jobs_connection_idx').on(t.connectionId, t.id), // P7: a connection's latest syncs
]);

export const syncJobItems = pgTable('sync_job_items', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  syncJobId: uuid('sync_job_id').notNull().references(() => syncJobs.id, { onDelete: 'cascade' }),
  externalId: text('external_id').notNull(),
  productId: uuid('product_id'),
  action: syncItemAction('action').notNull(),
  error: text('error'),
  createdAt: createdAt(),
}, (t) => [index('sync_items_job_idx').on(t.syncJobId, t.action)]);

export const webhookEvents = pgTable('webhook_events', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id'),
  provider: provider('provider').notNull(),
  providerEventId: text('provider_event_id').notNull(),
  topic: text('topic').notNull(),
  payload: json<Record<string, unknown>>('payload'),
  /** Always true today (T13: forged deliveries are not stored). Never replay a false one. */
  signatureValid: bool('signature_valid').notNull(),
  status: webhookStatus('status').notNull().default('received'),
  processedAt: ts('processed_at'),
  error: text('error'),
  attempts: integer('attempts').notNull().default(0),
  /** Not before this, after a failed attempt (0004). Null = now. */
  nextAttemptAt: ts('next_attempt_at'),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex('webhook_events_provider_event_unq').on(t.provider, t.providerEventId),
  index('webhook_events_status_idx').on(t.status, t.createdAt),
  index('webhook_events_connection_idx').on(t.connectionId, t.createdAt), // P7: a connection's deliveries by time
]);

export const fieldMappings = pgTable('field_mappings', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id').notNull().references(() => storeConnections.id, { onDelete: 'cascade' }),
  sourceField: text('source_field').notNull(),
  targetField: text('target_field').notNull(),
  transform: text('transform'),
  ...timestamps(),
}, (t) => [index('field_mappings_connection_idx').on(t.connectionId)]);

export const categories = pgTable('categories', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  parentId: uuid('parent_id'),
  name: text('name').notNull(),
  nameAr: text('name_ar'),
  slug: text('slug').notNull(),
  sortOrder: integer('sort_order').notNull().default(0),
  ...timestamps(),
}, (t) => [uniqueIndex('categories_tenant_slug_unq').on(t.tenantId, t.slug)]);

export type ProductImage = { url: string; alt?: string; width?: number; height?: number };
/** Millimetres. The try-on and comparison scale come from here — see `../tajribah-try-on`. */
export type ProductDimensions = { widthMm?: number; heightMm?: number; depthMm?: number; caseMm?: number };

export const products = pgTable('products', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  connectionId: uuid('connection_id'),
  externalId: text('external_id'),
  sku: text('sku'),
  name: text('name').notNull(),
  nameAr: text('name_ar'),
  description: text('description'),
  descriptionAr: text('description_ar'),
  priceMinor: integer('price_minor'),
  compareAtPriceMinor: integer('compare_at_price_minor'),
  currency: text('currency').notNull().default('SAR'),
  categoryId: uuid('category_id'),
  productType: productCategory('product_type').notNull().default('other'),
  images: json<ProductImage[]>('images'),
  dimensions: json<ProductDimensions>('dimensions'),
  attributes: json<Record<string, string>>('attributes'),
  status: productStatus('status').notNull().default('active'),
  arEnabled: bool('ar_enabled').notNull().default(false),
  tryonEnabled: bool('tryon_enabled').notNull().default(false),
  aiEnabled: bool('ai_enabled').notNull().default(false),
  primaryModelId: uuid('primary_model_id'),
  // `embedding vector(768)` (pgvector, §7.6) arrives with P6.1; the extension has to be
  // enabled on the cluster first, and an unused index is a cost with no benefit.
  syncedAt: ts('synced_at'),
  ...timestamps(),
  deletedAt: deletedAt(),
}, (t) => [
  uniqueIndex('products_tenant_connection_external_unq').on(t.tenantId, t.connectionId, t.externalId),
  index('products_tenant_status_idx').on(t.tenantId, t.status, t.createdAt),
  index('products_tenant_ar_idx').on(t.tenantId, t.arEnabled),
  index('products_tenant_name_idx').on(t.tenantId, t.name),
  index('products_tenant_id_idx').on(t.tenantId, t.id), // P7: the catalogue, newest first, by cursor
]);

export const productVariants = pgTable('product_variants', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  externalId: text('external_id'),
  sku: text('sku'),
  title: text('title').notNull(),
  options: json<Record<string, string>>('options'),
  priceMinor: integer('price_minor'),
  inventoryQuantity: integer('inventory_quantity'),
  imageUrl: text('image_url'),
  modelId: uuid('model_id'),
  ...timestamps(),
}, (t) => [index('variants_product_idx').on(t.productId)]);

export type StoreConnection = typeof storeConnections.$inferSelect;
export type Product = typeof products.$inferSelect;
export type SyncJob = typeof syncJobs.$inferSelect;
