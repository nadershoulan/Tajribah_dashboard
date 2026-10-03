/**
 * Jobs (T6), AI jobs (§7.8), flags, notifications and PDPL data requests (§7.9).
 *
 * `jobs` is the transport-independent source of truth: a queue may deliver the work, but
 * the row is what the merchant UI reads and what a restart recovers from. Claiming uses
 * `SELECT … FOR UPDATE SKIP LOCKED`, which is why there is no `processing` status and no
 * window where two workers hold the same job (§13.6).
 */
import { sql } from 'drizzle-orm';
import { index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bool, createdAt, json, pk, tenantId, timestamps, ts } from './_shared';
import { tenants } from './identity';
import { products } from './commerce';

export const JOB_STATE = ['queued', 'claimed', 'running', 'done', 'failed', 'dead', 'cancelled'] as const;
export const AI_JOB_TYPE = [
  'generate_3d', 'enhance_texture', 'embed_product', 'enrich_content', 'quality_check', 'convert_format',
] as const;

export type JobState = (typeof JOB_STATE)[number];

export const jobState = pgEnum('job_state', JOB_STATE);
export const aiJobType = pgEnum('ai_job_type', AI_JOB_TYPE);
export const aiJobStatus = pgEnum('ai_job_status', ['queued', 'processing', 'done', 'failed', 'cancelled']);
export const generationAngle = pgEnum('generation_angle', ['front', 'side', 'back', 'detail']);
export const generationPhotoStatus = pgEnum('generation_photo_status', ['uploading', 'accepted', 'rejected']);
export const notificationLevel = pgEnum('notification_level', ['info', 'success', 'warning', 'error']);
export const dataRequestType = pgEnum('data_request_type', ['export', 'erase']);
export const dataRequestStatus = pgEnum('data_request_status', ['received', 'processing', 'completed', 'rejected']);

export const jobs = pgTable('jobs', {
  id: pk(),
  /** Nullable: platform-wide jobs (rollups, cleanup) have no tenant. */
  tenantId: uuid('tenant_id'),
  /** `domain.action` — `sync.products`, `ai.generate-3d`, `edge.publish-config`. */
  queue: text('queue').notNull(),
  payload: json<Record<string, unknown>>('payload'),
  state: jobState('state').notNull().default('queued'),
  priority: integer('priority').notNull().default(100), // lower runs first
  attempts: integer('attempts').notNull().default(0),
  maxAttempts: integer('max_attempts').notNull().default(5),
  /** Set on failure with exponential backoff; a claim never picks up a future row. */
  runAfter: ts('run_after').notNull().defaultNow(),
  claimedBy: text('claimed_by'),
  claimedAt: ts('claimed_at'),
  startedAt: ts('started_at'),
  finishedAt: ts('finished_at'),
  lastError: text('last_error'),
  /** Same key, same job: an idempotent enqueue for schedulers and webhooks. */
  dedupeKey: text('dedupe_key'),
  ...timestamps(),
}, (t) => [
  index('jobs_claim_idx').on(t.queue, t.state, t.runAfter, t.priority),
  index('jobs_tenant_idx').on(t.tenantId, t.state),
  uniqueIndex('jobs_dedupe_unq').on(t.dedupeKey),
]);

export const aiJobs = pgTable('ai_jobs', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  type: aiJobType('type').notNull(),
  status: aiJobStatus('status').notNull().default('queued'),
  priority: integer('priority').notNull().default(100),
  input: json<Record<string, unknown>>('input'),
  output: json<Record<string, unknown>>('output'),
  modelRegistryId: uuid('model_registry_id'),
  /** What the merchant is charged. */
  creditsCost: integer('credits_cost').notNull().default(0),
  /** What it cost us, in US cents. Both numbers, or you cannot tell if a plan is profitable. */
  actualCostCents: integer('actual_cost_cents').notNull().default(0),
  gpuSeconds: integer('gpu_seconds'),
  queuedAt: ts('queued_at'),
  startedAt: ts('started_at'),
  finishedAt: ts('finished_at'),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  attempts: integer('attempts').notNull().default(0),
  parentJobId: uuid('parent_job_id'),
  ...timestamps(),
}, (t) => [
  index('ai_jobs_tenant_idx').on(t.tenantId, t.status, t.createdAt),
  index('ai_jobs_type_idx').on(t.type, t.status),
  index('ai_jobs_created_idx').on(t.createdAt), // P6.7: today's spend, across stores
  index('ai_jobs_tenant_id_idx').on(t.tenantId, t.id), // P7: the jobs screen, newest first
]);

export const aiJobEvents = pgTable('ai_job_events', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').notNull().references(() => aiJobs.id, { onDelete: 'cascade' }),
  event: text('event').notNull(),
  detail: json<Record<string, unknown>>('detail'),
  createdAt: createdAt(),
}, (t) => [index('ai_job_events_job_idx').on(t.jobId, t.createdAt)]);

/** Never hardcode a model name in business logic — look it up here (§5). */
export const modelRegistry = pgTable('model_registry', {
  id: pk(),
  name: text('name').notNull(),
  version: text('version').notNull(),
  provider: text('provider').notNull(),
  endpoint: text('endpoint'),
  /** P6: the kind of AI work this model does; new jobs of that type are split among the active ones. */
  jobType: aiJobType('job_type'),
  isActive: bool('is_active').notNull().default(false),
  abSplitPercent: integer('ab_split_percent').notNull().default(0),
  costPerCallCents: integer('cost_per_call_cents').notNull().default(0),
  avgLatencyMs: integer('avg_latency_ms'),
  successRateBp: integer('success_rate_bp'),
  rolledBackAt: ts('rolled_back_at'),
  ...timestamps(),
}, (t) => [uniqueIndex('model_registry_name_version_unq').on(t.name, t.version)]);

/**
 * P6.7 — the brakes staff can pull on AI spend: kinds of work paused, a platform daily spend cap
 * (US cents, what providers charge us) and a per-store daily job cap. One row, id `platform`; no
 * row, or a null, means no limit. Written only by the admin console, read only by the admin role.
 */
export const aiGuardrails = pgTable('ai_guardrails', {
  id: text('id').primaryKey(),
  pausedTypes: json<string[]>('paused_types').notNull().default([]),
  dailySpendCapCents: integer('daily_spend_cap_cents'),
  storeDailyJobsCap: integer('store_daily_jobs_cap'),
  updatedBy: uuid('updated_by'),
  ...timestamps(),
});

export const generationInputs = pgTable('generation_inputs', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  jobId: uuid('job_id').notNull().references(() => aiJobs.id, { onDelete: 'cascade' }),
  angle: generationAngle('angle').notNull(),
  storageKey: text('storage_key').notNull(),
  qualityScore: integer('quality_score'),
  issues: json<string[]>('issues'),
  createdAt: createdAt(),
}, (t) => [index('generation_inputs_job_idx').on(t.jobId)]);

/**
 * P3.3 — product photos a merchant uploads for 3D generation, checked before any credits are
 * spent. Photos exist before the job does (`generation_inputs` needs one), so they live here;
 * when a generation starts, its accepted photos are copied into `generation_inputs`.
 */
export const generationPhotos = pgTable('generation_photos', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  angle: generationAngle('angle').notNull(),
  status: generationPhotoStatus('status').notNull().default('uploading'),
  storageKey: text('storage_key').notNull(),
  originalFilename: text('original_filename'),
  /** What the bytes are (from their first bytes), not what the browser said. Null until checked. */
  format: text('format'),
  sizeBytes: integer('size_bytes'),
  width: integer('width'),
  height: integer('height'),
  /** SHA-256 of the bytes, hex: the same photo twice for one product is refused. */
  sha256: text('sha256'),
  qualityScore: integer('quality_score'),
  issues: json<string[]>('issues'),
  /** Set when the bytes are removed (rejected, replaced, deleted); the row stays as the record. */
  bytesDeletedAt: ts('bytes_deleted_at'),
  ...timestamps(),
}, (t) => [index('generation_photos_product_idx').on(t.tenantId, t.productId, t.status)]);

/** Platform-wide by default; a row with a tenant id overrides it for that tenant only. */
export const featureFlags = pgTable('feature_flags', {
  id: pk(),
  key: text('key').notNull(),
  tenantId: uuid('tenant_id'),
  enabled: bool('enabled').notNull().default(false),
  rolloutPercent: integer('rollout_percent').notNull().default(0),
  note: text('note'),
  ...timestamps(),
}, (t) => [uniqueIndex('feature_flags_key_tenant_unq').on(t.key, t.tenantId)]);

export const webhookDeliveryStatus = pgEnum('webhook_delivery_status', ['pending', 'delivered', 'failed']);

/** P8 — where a store's events are sent (outgoing; `webhook_events` holds the incoming ones). */
export const webhookEndpoints = pgTable('webhook_endpoints', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  description: text('description'),
  /** The signing secret, sealed under ENCRYPTION_KEY and bound to the endpoint id. Shown once. */
  secretEncrypted: text('secret_encrypted').notNull(),
  events: json<string[]>('events').notNull(),
  active: bool('active').notNull().default(true),
  /** Set when the platform turned it off (deliveries kept failing); null when on, or turned off by a person. */
  disabledReason: text('disabled_reason'),
  consecutiveFailures: integer('consecutive_failures').notNull().default(0),
  lastDeliveryAt: ts('last_delivery_at'),
  lastStatus: integer('last_status'),
  createdBy: uuid('created_by'),
  ...timestamps(),
}, (t) => [index('webhook_endpoints_tenant_idx').on(t.tenantId)]);

/** P8 — one event for one endpoint, and how its delivery went. */
export const webhookDeliveries = pgTable('webhook_deliveries', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  endpointId: uuid('endpoint_id').notNull().references(() => webhookEndpoints.id, { onDelete: 'cascade' }),
  /** The event's id — the same for every endpoint, so a receiver can drop a repeat. */
  eventId: text('event_id').notNull(),
  event: text('event').notNull(),
  payload: json<Record<string, unknown>>('payload').notNull(),
  status: webhookDeliveryStatus('status').notNull().default('pending'),
  attempts: integer('attempts').notNull().default(0),
  nextAttemptAt: ts('next_attempt_at'),
  responseStatus: integer('response_status'),
  error: text('error'),
  deliveredAt: ts('delivered_at'),
  ...timestamps(),
}, (t) => [
  index('webhook_deliveries_endpoint_idx').on(t.endpointId, t.id),
  index('webhook_deliveries_pending_idx').on(t.status, t.nextAttemptAt),
]);

export const notifications = pgTable('notifications', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  userId: uuid('user_id'),
  type: text('type').notNull(),
  titleAr: text('title_ar').notNull(),
  titleEn: text('title_en').notNull(),
  bodyAr: text('body_ar'),
  bodyEn: text('body_en'),
  href: text('href'),
  level: notificationLevel('level').notNull().default('info'),
  readAt: ts('read_at'),
  createdAt: createdAt(),
}, (t) => [
  index('notifications_tenant_user_idx').on(t.tenantId, t.userId, t.readAt),
  index('notifications_tenant_user_time_idx').on(t.tenantId, t.userId, t.createdAt), // P7: the bell, newest first
]);

/**
 * PDPL: a data subject's export or erasure request (§7.9) — the register the admin console keeps
 * (A14, T22; drizzle/0014). `tenantId` is null for a person's request about their own account.
 * `requestedBy` is who recorded it (staff, for a request made to support).
 */
export const dataRequests = pgTable('data_requests', {
  id: pk(),
  tenantId: uuid('tenant_id').references(() => tenants.id, { onDelete: 'cascade' }),
  type: dataRequestType('type').notNull(),
  requestedBy: uuid('requested_by').notNull(),
  subjectEmail: text('subject_email'),
  subjectUserId: uuid('subject_user_id'),
  /** 30 days from receipt (T22). */
  dueAt: ts('due_at'),
  handledBy: uuid('handled_by'),
  /** How the requester's identity was confirmed, in staff's words. */
  identityCheck: text('identity_check'),
  status: dataRequestStatus('status').notNull().default('received'),
  resultStorageKey: text('result_storage_key'),
  completedAt: ts('completed_at'),
  note: text('note'),
  ...timestamps(),
}, (t) => [index('data_requests_tenant_idx').on(t.tenantId, t.status)]);

/**
 * A13 (T23, drizzle/0015): announcements — bilingual notices on every store's dashboard between
 * two times, written by staff in the admin console. A platform catalogue: read-only to the app.
 */
export const announcementLevel = pgEnum('announcement_level', ['info', 'warning']);
export const announcements = pgTable('announcements', {
  id: pk(),
  titleAr: text('title_ar').notNull(),
  titleEn: text('title_en').notNull(),
  bodyAr: text('body_ar'),
  bodyEn: text('body_en'),
  level: announcementLevel('level').notNull().default('info'),
  /** A dashboard path (`/dashboard/…`) the notice links to, or null. */
  link: text('link'),
  startsAt: ts('starts_at').notNull(),
  endsAt: ts('ends_at').notNull(),
  active: bool('active').notNull().default(true),
  createdBy: uuid('created_by').notNull(),
  ...timestamps(),
}, (t) => [index('announcements_window_idx').on(t.active, t.startsAt, t.endsAt)]);

export type Job = typeof jobs.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type AiJob = typeof aiJobs.$inferSelect;

/**
 * P3.10 (0037) — a professional 3D model made by Tajribah's team for one product. The merchant asks
 * (`requested`, with a note); staff quote a price in halalas, VAT added at checkout (`quoted`); paying
 * — and so `accepted` and `delivered` — opens with the payment gateway (P2.3). The merchant may cancel
 * before work starts. One open order per product (a partial unique index).
 */
export const PROFESSIONAL_ORDER_STATUS = ['requested', 'quoted', 'accepted', 'delivered', 'cancelled'] as const;
export const professionalOrderStatus = pgEnum('professional_order_status', PROFESSIONAL_ORDER_STATUS);
export const professionalOrders = pgTable('professional_orders', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  status: professionalOrderStatus('status').notNull().default('requested'),
  note: text('note'),
  requestedBy: uuid('requested_by'),
  priceMinor: integer('price_minor'),
  currency: text('currency').notNull().default('SAR'),
  quoteNote: text('quote_note'),
  quotedAt: ts('quoted_at'),
  quotedBy: uuid('quoted_by'),
  cancelledAt: ts('cancelled_at'),
  /** T68 (0039): before card payments — accepted by the merchant, the transfer recorded by staff, delivered. */
  acceptedAt: ts('accepted_at'),
  paidAt: ts('paid_at'),
  paymentReference: text('payment_reference'),
  deliveredModelId: uuid('delivered_model_id'),
  deliveredVersionId: uuid('delivered_version_id'),
  deliveredAt: ts('delivered_at'),
  ...timestamps(),
}, (t) => [
  uniqueIndex('professional_orders_open_unq').on(t.productId).where(sql`${t.status} in ('requested', 'quoted', 'accepted')`),
  index('professional_orders_tenant_idx').on(t.tenantId, t.createdAt),
  index('professional_orders_status_idx').on(t.status, t.createdAt),
]);
