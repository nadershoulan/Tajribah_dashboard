/**
 * §7.7 — 3D models, AR configuration, try-on configuration, hosted pages.
 *
 * Two shapes here are deliberate and easy to "fix" wrongly:
 *  - `model_files` is one row per file. A version produces GLB, USDZ, an optimized GLB and
 *    two LOD levels — five rows. Columns on the version would break at the sixth format.
 *  - `models_3d.current_version_id` is the *only* marker of the live version. Do not add
 *    `is_current` to `model_versions`: a flag on many rows and a pointer on one are two
 *    sources of truth for one fact, and nothing in the database can make them agree.
 *    `isCurrent` is computed in the API response.
 */
import { index, integer, pgEnum, pgTable, text, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { bool, createdAt, json, pk, tenantId, timestamps, ts } from './_shared';
import { tenants } from './identity';
import { products } from './commerce';

export const MODEL_SOURCE = ['uploaded', 'ai_generated', 'professional_service'] as const;
export const MODEL_STATUS = ['draft', 'processing', 'ready', 'failed', 'archived'] as const;
export const QA_STATUS = ['pending', 'approved', 'rejected'] as const;
export const MODEL_FORMAT = ['glb', 'usdz', 'gltf', 'fbx', 'obj'] as const;
export const MODEL_VARIANT = ['original', 'optimized', 'lod1', 'lod2'] as const;
export const TRYON_CATEGORY = ['glasses', 'watch', 'ring', 'necklace', 'earring', 'bag'] as const;

export type TryOnCategory = (typeof TRYON_CATEGORY)[number];

export const modelSource = pgEnum('model_source', MODEL_SOURCE);
export const modelStatus = pgEnum('model_status', MODEL_STATUS);
export const qaStatus = pgEnum('qa_status', QA_STATUS);
export const modelFormat = pgEnum('model_format', MODEL_FORMAT);
export const modelVariant = pgEnum('model_variant', MODEL_VARIANT);
export const tryonCategory = pgEnum('tryon_category', TRYON_CATEGORY);
export const arPlacement = pgEnum('ar_placement', ['floor', 'wall', 'table', 'face', 'wrist']);
export const compression = pgEnum('compression', ['none', 'draco', 'meshopt']);

export const models3d = pgTable('models_3d', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }),
  variantId: uuid('variant_id'),
  name: text('name').notNull(),
  source: modelSource('source').notNull(),
  status: modelStatus('status').notNull().default('draft'),
  currentVersionId: uuid('current_version_id'),
  qaStatus: qaStatus('qa_status').notNull().default('pending'),
  qaReviewedBy: uuid('qa_reviewed_by'),
  qaNotes: text('qa_notes'),
  createdBy: uuid('created_by'),
  ...timestamps(),
}, (t) => [
  index('models_tenant_idx').on(t.tenantId, t.status),
  index('models_product_idx').on(t.productId),
]);

export const modelVersions = pgTable('model_versions', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  modelId: uuid('model_id').notNull().references(() => models3d.id, { onDelete: 'cascade' }),
  version: integer('version').notNull(),
  status: modelStatus('status').notNull().default('processing'),
  polyCount: integer('poly_count'),
  materialCount: integer('material_count'),
  textureCount: integer('texture_count'),
  boundingBox: json<{ min: [number, number, number]; max: [number, number, number] }>('bounding_box'),
  sourceJobId: uuid('source_job_id'),
  /** Why it failed, in the checker's words (0003). Null unless `failed`. */
  error: text('error'),
  publishedAt: ts('published_at'),
  createdBy: uuid('created_by'),
  ...timestamps(),
}, (t) => [uniqueIndex('model_versions_model_version_unq').on(t.modelId, t.version)]);

export const modelFiles = pgTable('model_files', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  modelVersionId: uuid('model_version_id').notNull().references(() => modelVersions.id, { onDelete: 'cascade' }),
  format: modelFormat('format').notNull(),
  variant: modelVariant('variant').notNull().default('original'),
  /** Storage-agnostic on purpose (D4) — never name this `r2_key`. */
  storageKey: text('storage_key').notNull(),
  cdnUrl: text('cdn_url'),
  fileSizeBytes: integer('file_size_bytes').notNull().default(0),
  /** P2.2: set when the bytes were deleted (refused, expired). Storage held counts only null rows. */
  bytesDeletedAt: ts('bytes_deleted_at'),
  checksum: text('checksum'),
  originalFilename: text('original_filename'),
  compression: compression('compression').notNull().default('none'),
  createdAt: createdAt(),
}, (t) => [index('model_files_version_idx').on(t.modelVersionId, t.format, t.variant)]);

export const arConfigs = pgTable('ar_configs', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  buttonStyle: json<{ variant?: string; color?: string; radius?: number; icon?: boolean }>('button_style'),
  buttonLabelAr: text('button_label_ar').notNull().default('شاهدها في مكانك'),
  buttonLabelEn: text('button_label_en').notNull().default('View in your space'),
  placement: arPlacement('placement').notNull().default('floor'),
  scaleFactorBp: integer('scale_factor_bp').notNull().default(10000), // basis points; 10000 = 1.0
  autoRotate: bool('auto_rotate').notNull().default(true),
  shadowIntensityBp: integer('shadow_intensity_bp').notNull().default(10000),
  environmentHdri: text('environment_hdri'),
  cameraOrbit: text('camera_orbit'),
  hotspots: json<{ id: string; position: [number, number, number]; labelAr: string; labelEn: string }[]>('hotspots'),
  /** Bumped on every publish; the KV key includes it, so caches never need purging by name. */
  publishedVersion: integer('published_version').notNull().default(0),
  publishedAt: ts('published_at'),
  ...timestamps(),
}, (t) => [uniqueIndex('ar_configs_product_unq').on(t.productId)]);

export const tryonConfigs = pgTable('tryon_configs', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  category: tryonCategory('category').notNull(),
  /** Landmark indices and the anchor transform, per category. */
  anchorPoints: json<Record<string, number[]>>('anchor_points'),
  /** Real-world reference size in millimetres — what makes the overlay true to scale. */
  scaleReferenceMm: integer('scale_reference_mm'),
  offset: json<{ x: number; y: number; z?: number; angle?: number }>('offset'),
  occlusionEnabled: bool('occlusion_enabled').notNull().default(false),
  qualityScore: integer('quality_score'),
  calibratedAt: ts('calibrated_at'),
  /**
   * P5.10 (0017) — what the owner's studio needs for one watch (T26): the cut-out as worn and the
   * flat product shot (transparent PNG/WebP, stored where the CDN serves them), the case width in
   * tenths of a millimetre (29.3 mm is not a whole number; `scale_reference_mm` is), the finish
   * line, and whether the shop's button opens the studio.
   */
  wornKey: text('worn_key'),
  wornBytes: integer('worn_bytes'),
  flatKey: text('flat_key'),
  flatBytes: integer('flat_bytes'),
  caseTenthsMm: integer('case_tenths_mm'),
  finishAr: text('finish_ar'),
  finishEn: text('finish_en'),
  enabled: bool('enabled').notNull().default(false),
  ...timestamps(),
}, (t) => [uniqueIndex('tryon_configs_product_unq').on(t.productId)]);

export const qrCodes = pgTable('qr_codes', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'cascade' }),
  code: text('code').notNull(),
  shortUrl: text('short_url'),
  label: text('label'),
  scanCount: integer('scan_count').notNull().default(0),
  ...timestamps(),
}, (t) => [uniqueIndex('qr_codes_code_unq').on(t.code)]);

export const hostedPages = pgTable('hosted_pages', {
  id: pk(),
  tenantId: tenantId().references(() => tenants.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  theme: json<{ primary?: string; logoUrl?: string; dark?: boolean }>('theme'),
  isActive: bool('is_active').notNull().default(true),
  viewCount: integer('view_count').notNull().default(0),
  ...timestamps(),
}, (t) => [uniqueIndex('hosted_pages_slug_unq').on(t.slug)]);

export type Model3d = typeof models3d.$inferSelect;
export type ModelVersion = typeof modelVersions.$inferSelect;
export type ModelFile = typeof modelFiles.$inferSelect;
export type ArConfig = typeof arConfigs.$inferSelect;
