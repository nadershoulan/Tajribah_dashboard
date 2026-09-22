CREATE TYPE "public"."actor_type" AS ENUM('user', 'system', 'staff', 'api_key', 'webhook');--> statement-breakpoint
CREATE TYPE "public"."locale" AS ENUM('ar', 'en');--> statement-breakpoint
CREATE TYPE "public"."member_role" AS ENUM('owner', 'admin', 'editor', 'analyst', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'invited', 'suspended');--> statement-breakpoint
CREATE TYPE "public"."product_category" AS ENUM('jewelry', 'watch', 'eyewear', 'bag', 'apparel', 'furniture', 'other');--> statement-breakpoint
CREATE TYPE "public"."revoked_reason" AS ENUM('logout', 'rotation_reuse', 'password_change', 'admin', 'expired');--> statement-breakpoint
CREATE TYPE "public"."tenant_goal" AS ENUM('ar_viewer', 'virtual_tryon', 'ai_3d_models');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('trial', 'active', 'past_due', 'suspended', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."verification_purpose" AS ENUM('email_verify', 'password_reset', 'phone_otp', 'email_change');--> statement-breakpoint
CREATE TYPE "public"."billing_cycle" AS ENUM('monthly', 'annual');--> statement-breakpoint
CREATE TYPE "public"."subscription_change_type" AS ENUM('upgrade', 'downgrade', 'cycle_change', 'cancel', 'resume');--> statement-breakpoint
CREATE TYPE "public"."credit_reason" AS ENUM('purchase', 'plan_grant', 'consumption', 'refund', 'adjustment', 'expiry');--> statement-breakpoint
CREATE TYPE "public"."invoice_status" AS ENUM('draft', 'issued', 'paid', 'void', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."limit_key" AS ENUM('products', 'ai_credits', 'storage_gb', 'ar_sessions', 'team_members', 'bandwidth_gb');--> statement-breakpoint
CREATE TYPE "public"."payment_method_kind" AS ENUM('mada', 'card', 'applepay', 'stcpay', 'bank_transfer');--> statement-breakpoint
CREATE TYPE "public"."payment_status" AS ENUM('initiated', 'authorized', 'captured', 'failed', 'refunded');--> statement-breakpoint
CREATE TYPE "public"."plan_code" AS ENUM('starter', 'growth', 'pro', 'enterprise');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('trialing', 'active', 'past_due', 'paused', 'cancelled', 'expired');--> statement-breakpoint
CREATE TYPE "public"."zatca_status" AS ENUM('pending', 'reported', 'cleared', 'failed');--> statement-breakpoint
CREATE TYPE "public"."connection_status" AS ENUM('active', 'expired', 'revoked', 'error');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."product_status" AS ENUM('active', 'draft', 'archived');--> statement-breakpoint
CREATE TYPE "public"."provider" AS ENUM('salla', 'zid', 'shopify', 'woocommerce');--> statement-breakpoint
CREATE TYPE "public"."sync_item_action" AS ENUM('created', 'updated', 'skipped', 'failed');--> statement-breakpoint
CREATE TYPE "public"."sync_trigger" AS ENUM('schedule', 'user', 'webhook', 'system');--> statement-breakpoint
CREATE TYPE "public"."sync_type" AS ENUM('full', 'incremental', 'single_product', 'inventory', 'orders');--> statement-breakpoint
CREATE TYPE "public"."webhook_status" AS ENUM('received', 'processed', 'failed', 'ignored');--> statement-breakpoint
CREATE TYPE "public"."ar_placement" AS ENUM('floor', 'wall', 'table', 'face', 'wrist');--> statement-breakpoint
CREATE TYPE "public"."compression" AS ENUM('none', 'draco', 'meshopt');--> statement-breakpoint
CREATE TYPE "public"."model_format" AS ENUM('glb', 'usdz', 'gltf', 'fbx', 'obj');--> statement-breakpoint
CREATE TYPE "public"."model_source" AS ENUM('uploaded', 'ai_generated', 'professional_service');--> statement-breakpoint
CREATE TYPE "public"."model_status" AS ENUM('draft', 'processing', 'ready', 'failed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."model_variant" AS ENUM('original', 'optimized', 'lod1', 'lod2');--> statement-breakpoint
CREATE TYPE "public"."qa_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."tryon_category" AS ENUM('glasses', 'watch', 'ring', 'necklace', 'earring', 'bag');--> statement-breakpoint
CREATE TYPE "public"."ai_job_status" AS ENUM('queued', 'processing', 'done', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."ai_job_type" AS ENUM('generate_3d', 'enhance_texture', 'embed_product', 'enrich_content', 'quality_check', 'convert_format');--> statement-breakpoint
CREATE TYPE "public"."data_request_status" AS ENUM('received', 'processing', 'completed', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."data_request_type" AS ENUM('export', 'erase');--> statement-breakpoint
CREATE TYPE "public"."generation_angle" AS ENUM('front', 'side', 'back', 'detail');--> statement-breakpoint
CREATE TYPE "public"."job_state" AS ENUM('queued', 'claimed', 'running', 'done', 'failed', 'dead', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."notification_level" AS ENUM('info', 'success', 'warning', 'error');--> statement-breakpoint
CREATE TYPE "public"."device_type" AS ENUM('mobile', 'tablet', 'desktop', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."event_type" AS ENUM('product_view', 'ar_open', 'ar_place', 'ar_close', 'tryon_start', 'tryon_capture', 'tryon_share', 'add_to_cart', 'purchase');--> statement-breakpoint
CREATE TABLE "api_keys" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"key_prefix" text NOT NULL,
	"key_hash" text NOT NULL,
	"scopes" jsonb,
	"last_used_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"revoked_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"actor_user_id" uuid,
	"actor_type" "actor_type" DEFAULT 'user' NOT NULL,
	"action" text NOT NULL,
	"resource_type" text NOT NULL,
	"resource_id" text,
	"changes" jsonb,
	"ip_hash" text,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invitations" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"email" text NOT NULL,
	"role" "member_role" DEFAULT 'viewer' NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"accepted_at" timestamp with time zone,
	"invited_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "refresh_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"replaced_by_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid,
	"user_agent" text,
	"ip_hash" text,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_reason" "revoked_reason",
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_memberships" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "member_role" DEFAULT 'viewer' NOT NULL,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_settings" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"branding" jsonb,
	"white_label" boolean DEFAULT false NOT NULL,
	"custom_domain" text,
	"consent_text_ar" text,
	"consent_text_en" text,
	"notification_prefs" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"name_ar" text,
	"status" "tenant_status" DEFAULT 'trial' NOT NULL,
	"plan_id" uuid,
	"trial_ends_at" timestamp with time zone,
	"country" text DEFAULT 'SA' NOT NULL,
	"timezone" text DEFAULT 'Asia/Riyadh' NOT NULL,
	"locale" "locale" DEFAULT 'ar' NOT NULL,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"cr_number" text,
	"vat_number" text,
	"national_address" text,
	"city" text,
	"logo_url" text,
	"product_category" "product_category",
	"goal" "tenant_goal",
	"onboarding_state" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"email_verified_at" timestamp with time zone,
	"phone" text,
	"phone_verified_at" timestamp with time zone,
	"password_hash" text NOT NULL,
	"full_name" text NOT NULL,
	"locale" "locale" DEFAULT 'ar' NOT NULL,
	"avatar_url" text,
	"totp_secret_encrypted" text,
	"totp_enabled" boolean DEFAULT false NOT NULL,
	"backup_codes_hash" jsonb,
	"last_login_at" timestamp with time zone,
	"failed_login_count" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"is_staff" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "verification_tokens" (
	"id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid,
	"purpose" "verification_purpose" NOT NULL,
	"token_hash" text NOT NULL,
	"destination" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "billing_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"provider_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb,
	"processed_at" timestamp with time zone,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "credit_ledger" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"delta" integer NOT NULL,
	"balance_after" integer NOT NULL,
	"reason" "credit_reason" NOT NULL,
	"reference_type" text,
	"reference_id" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_lines" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid NOT NULL,
	"description" text NOT NULL,
	"description_ar" text,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"amount_minor" integer NOT NULL,
	"tax_minor" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "invoice_sequences" (
	"tenant_id" uuid NOT NULL,
	"year" integer NOT NULL,
	"next_number" integer DEFAULT 1 NOT NULL,
	CONSTRAINT "invoice_sequences_tenant_id_year_pk" PRIMARY KEY("tenant_id","year")
);
--> statement-breakpoint
CREATE TABLE "invoices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_number" text NOT NULL,
	"subscription_id" uuid,
	"status" "invoice_status" DEFAULT 'draft' NOT NULL,
	"subtotal_minor" integer NOT NULL,
	"vat_rate_bp" integer DEFAULT 1500 NOT NULL,
	"vat_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" char(3) DEFAULT 'SAR' NOT NULL,
	"issued_at" timestamp with time zone,
	"due_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"pdf_storage_key" text,
	"zatca_uuid" text,
	"zatca_hash" text,
	"zatca_qr" text,
	"zatca_status" "zatca_status",
	"buyer_vat_number" text,
	"buyer_cr_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"invoice_id" uuid,
	"amount_minor" integer NOT NULL,
	"currency" char(3) DEFAULT 'SAR' NOT NULL,
	"status" "payment_status" DEFAULT 'initiated' NOT NULL,
	"method" "payment_method_kind",
	"provider" text DEFAULT 'moyasar' NOT NULL,
	"provider_payment_id" text,
	"failure_code" text,
	"idempotency_key" text,
	"raw_response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_features" (
	"plan_id" uuid NOT NULL,
	"feature_key" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "plan_features_plan_id_feature_key_pk" PRIMARY KEY("plan_id","feature_key")
);
--> statement-breakpoint
CREATE TABLE "plan_limits" (
	"plan_id" uuid NOT NULL,
	"key" "limit_key" NOT NULL,
	"value" integer NOT NULL,
	CONSTRAINT "plan_limits_plan_id_key_pk" PRIMARY KEY("plan_id","key")
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" "plan_code" NOT NULL,
	"name" text NOT NULL,
	"name_ar" text NOT NULL,
	"price_monthly_minor" integer NOT NULL,
	"price_annual_minor" integer NOT NULL,
	"currency" char(3) DEFAULT 'SAR' NOT NULL,
	"is_public" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscription_changes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"from_plan_id" uuid,
	"to_plan_id" uuid NOT NULL,
	"change_type" "subscription_change_type" NOT NULL,
	"proration_minor" integer DEFAULT 0 NOT NULL,
	"effective_at" timestamp with time zone NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"status" "subscription_status" DEFAULT 'trialing' NOT NULL,
	"billing_cycle" "billing_cycle" DEFAULT 'monthly' NOT NULL,
	"current_period_start" timestamp with time zone NOT NULL,
	"current_period_end" timestamp with time zone NOT NULL,
	"cancel_at_period_end" boolean DEFAULT false NOT NULL,
	"cancelled_at" timestamp with time zone,
	"provider" text DEFAULT 'none' NOT NULL,
	"provider_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"tenant_id" uuid NOT NULL,
	"period_start" timestamp with time zone NOT NULL,
	"metric" "limit_key" NOT NULL,
	"value" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_tenant_id_period_start_metric_pk" PRIMARY KEY("tenant_id","period_start","metric")
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"parent_id" uuid,
	"name" text NOT NULL,
	"name_ar" text,
	"slug" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "field_mappings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"source_field" text NOT NULL,
	"target_field" text NOT NULL,
	"transform" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "product_variants" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"external_id" text,
	"sku" text,
	"title" text NOT NULL,
	"options" jsonb,
	"price_minor" integer,
	"inventory_quantity" integer,
	"image_url" text,
	"model_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid,
	"external_id" text,
	"sku" text,
	"name" text NOT NULL,
	"name_ar" text,
	"description" text,
	"description_ar" text,
	"price_minor" integer,
	"compare_at_price_minor" integer,
	"currency" text DEFAULT 'SAR' NOT NULL,
	"category_id" uuid,
	"product_type" "product_category" DEFAULT 'other' NOT NULL,
	"images" jsonb,
	"dimensions" jsonb,
	"attributes" jsonb,
	"status" "product_status" DEFAULT 'active' NOT NULL,
	"ar_enabled" boolean DEFAULT false NOT NULL,
	"tryon_enabled" boolean DEFAULT false NOT NULL,
	"ai_enabled" boolean DEFAULT false NOT NULL,
	"primary_model_id" uuid,
	"synced_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"deleted_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "store_connections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"provider" "provider" NOT NULL,
	"external_store_id" text NOT NULL,
	"store_name" text,
	"store_url" text,
	"access_token_encrypted" text,
	"refresh_token_encrypted" text,
	"token_expires_at" timestamp with time zone,
	"scopes" jsonb,
	"status" "connection_status" DEFAULT 'active' NOT NULL,
	"last_sync_at" timestamp with time zone,
	"sync_interval_minutes" integer DEFAULT 60 NOT NULL,
	"last_error" text,
	"health_score" integer DEFAULT 100 NOT NULL,
	"settings" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_job_items" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sync_job_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"product_id" uuid,
	"action" "sync_item_action" NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid NOT NULL,
	"type" "sync_type" NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"cursor" text,
	"total_items" integer DEFAULT 0 NOT NULL,
	"processed_items" integer DEFAULT 0 NOT NULL,
	"failed_items" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error" text,
	"triggered_by" "sync_trigger" DEFAULT 'schedule' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"connection_id" uuid,
	"provider" "provider" NOT NULL,
	"provider_event_id" text NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb,
	"signature_valid" boolean NOT NULL,
	"status" "webhook_status" DEFAULT 'received' NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ar_configs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"button_style" jsonb,
	"button_label_ar" text DEFAULT 'شاهدها في مكانك' NOT NULL,
	"button_label_en" text DEFAULT 'View in your space' NOT NULL,
	"placement" "ar_placement" DEFAULT 'floor' NOT NULL,
	"scale_factor_bp" integer DEFAULT 10000 NOT NULL,
	"auto_rotate" boolean DEFAULT true NOT NULL,
	"shadow_intensity_bp" integer DEFAULT 10000 NOT NULL,
	"environment_hdri" text,
	"camera_orbit" text,
	"hotspots" jsonb,
	"published_version" integer DEFAULT 0 NOT NULL,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "hosted_pages" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"theme" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"view_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_files" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"model_version_id" uuid NOT NULL,
	"format" "model_format" NOT NULL,
	"variant" "model_variant" DEFAULT 'original' NOT NULL,
	"storage_key" text NOT NULL,
	"cdn_url" text,
	"file_size_bytes" integer DEFAULT 0 NOT NULL,
	"checksum" text,
	"original_filename" text,
	"compression" "compression" DEFAULT 'none' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_versions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"model_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" "model_status" DEFAULT 'processing' NOT NULL,
	"poly_count" integer,
	"material_count" integer,
	"texture_count" integer,
	"bounding_box" jsonb,
	"source_job_id" uuid,
	"published_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "models_3d" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid,
	"variant_id" uuid,
	"name" text NOT NULL,
	"source" "model_source" NOT NULL,
	"status" "model_status" DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"qa_status" "qa_status" DEFAULT 'pending' NOT NULL,
	"qa_reviewed_by" uuid,
	"qa_notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "qr_codes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid,
	"code" text NOT NULL,
	"short_url" text,
	"label" text,
	"scan_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tryon_configs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"category" "tryon_category" NOT NULL,
	"anchor_points" jsonb,
	"scale_reference_mm" integer,
	"offset" jsonb,
	"occlusion_enabled" boolean DEFAULT false NOT NULL,
	"quality_score" integer,
	"calibrated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_job_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"event" text NOT NULL,
	"detail" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ai_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "ai_job_type" NOT NULL,
	"status" "ai_job_status" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"model_registry_id" uuid,
	"credits_cost" integer DEFAULT 0 NOT NULL,
	"actual_cost_cents" integer DEFAULT 0 NOT NULL,
	"gpu_seconds" integer,
	"queued_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"attempts" integer DEFAULT 0 NOT NULL,
	"parent_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"type" "data_request_type" NOT NULL,
	"requested_by" uuid NOT NULL,
	"subject_email" text,
	"status" "data_request_status" DEFAULT 'received' NOT NULL,
	"result_storage_key" text,
	"completed_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "feature_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"tenant_id" uuid,
	"enabled" boolean DEFAULT false NOT NULL,
	"rollout_percent" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_inputs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"job_id" uuid NOT NULL,
	"angle" "generation_angle" NOT NULL,
	"storage_key" text NOT NULL,
	"quality_score" integer,
	"issues" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid,
	"queue" text NOT NULL,
	"payload" jsonb,
	"state" "job_state" DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 100 NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 5 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"claimed_by" text,
	"claimed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	"dedupe_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "model_registry" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"version" text NOT NULL,
	"provider" text NOT NULL,
	"endpoint" text,
	"is_active" boolean DEFAULT false NOT NULL,
	"ab_split_percent" integer DEFAULT 0 NOT NULL,
	"cost_per_call_cents" integer DEFAULT 0 NOT NULL,
	"avg_latency_ms" integer,
	"success_rate_bp" integer,
	"rolled_back_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid,
	"type" text NOT NULL,
	"title_ar" text NOT NULL,
	"title_en" text NOT NULL,
	"body_ar" text,
	"body_en" text,
	"href" text,
	"level" "notification_level" DEFAULT 'info' NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "analytics_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"event_type" "event_type" NOT NULL,
	"product_id" uuid,
	"session_id" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"device_type" "device_type" DEFAULT 'unknown' NOT NULL,
	"os" text,
	"browser" text,
	"country" text,
	"region" text,
	"referrer_host" text,
	"ar_supported" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"value_minor" bigint,
	"currency" text,
	"properties" jsonb
);
--> statement-breakpoint
CREATE TABLE "conversion_daily" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"day" date NOT NULL,
	"sessions_with_ar" integer DEFAULT 0 NOT NULL,
	"purchases_with_ar" integer DEFAULT 0 NOT NULL,
	"sessions_without_ar" integer DEFAULT 0 NOT NULL,
	"purchases_without_ar" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "conversion_daily_tenant_id_product_id_day_pk" PRIMARY KEY("tenant_id","product_id","day")
);
--> statement-breakpoint
CREATE TABLE "daily_product_stats" (
	"tenant_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"ar_sessions" integer DEFAULT 0 NOT NULL,
	"tryon_sessions" integer DEFAULT 0 NOT NULL,
	"add_to_cart" integer DEFAULT 0 NOT NULL,
	"purchases" integer DEFAULT 0 NOT NULL,
	"revenue_minor" bigint DEFAULT 0 NOT NULL,
	"avg_ar_duration_ms" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_product_stats_tenant_id_product_id_day_pk" PRIMARY KEY("tenant_id","product_id","day")
);
--> statement-breakpoint
CREATE TABLE "daily_tenant_stats" (
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"views" integer DEFAULT 0 NOT NULL,
	"ar_sessions" integer DEFAULT 0 NOT NULL,
	"tryon_sessions" integer DEFAULT 0 NOT NULL,
	"add_to_cart" integer DEFAULT 0 NOT NULL,
	"purchases" integer DEFAULT 0 NOT NULL,
	"revenue_minor" bigint DEFAULT 0 NOT NULL,
	"unique_sessions" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "daily_tenant_stats_tenant_id_day_pk" PRIMARY KEY("tenant_id","day")
);
--> statement-breakpoint
CREATE TABLE "device_breakdown_daily" (
	"tenant_id" uuid NOT NULL,
	"day" date NOT NULL,
	"device_type" "device_type" NOT NULL,
	"sessions" integer DEFAULT 0 NOT NULL,
	"ar_supported" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "device_breakdown_daily_tenant_id_day_device_type_pk" PRIMARY KEY("tenant_id","day","device_type")
);
--> statement-breakpoint
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_session_id_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_memberships" ADD CONSTRAINT "tenant_memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_settings" ADD CONSTRAINT "tenant_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_tokens" ADD CONSTRAINT "verification_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "public"."invoices"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoice_sequences" ADD CONSTRAINT "invoice_sequences_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_features" ADD CONSTRAINT "plan_features_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_limits" ADD CONSTRAINT "plan_limits_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_changes" ADD CONSTRAINT "subscription_changes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_changes" ADD CONSTRAINT "subscription_changes_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "categories" ADD CONSTRAINT "categories_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_mappings" ADD CONSTRAINT "field_mappings_connection_id_store_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."store_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_connections" ADD CONSTRAINT "store_connections_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_job_items" ADD CONSTRAINT "sync_job_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_job_items" ADD CONSTRAINT "sync_job_items_sync_job_id_sync_jobs_id_fk" FOREIGN KEY ("sync_job_id") REFERENCES "public"."sync_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_jobs" ADD CONSTRAINT "sync_jobs_connection_id_store_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."store_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_configs" ADD CONSTRAINT "ar_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ar_configs" ADD CONSTRAINT "ar_configs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_pages" ADD CONSTRAINT "hosted_pages_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "hosted_pages" ADD CONSTRAINT "hosted_pages_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_files" ADD CONSTRAINT "model_files_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_files" ADD CONSTRAINT "model_files_model_version_id_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_versions" ADD CONSTRAINT "model_versions_model_id_models_3d_id_fk" FOREIGN KEY ("model_id") REFERENCES "public"."models_3d"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models_3d" ADD CONSTRAINT "models_3d_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "models_3d" ADD CONSTRAINT "models_3d_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "qr_codes" ADD CONSTRAINT "qr_codes_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tryon_configs" ADD CONSTRAINT "tryon_configs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tryon_configs" ADD CONSTRAINT "tryon_configs_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_job_events" ADD CONSTRAINT "ai_job_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_job_events" ADD CONSTRAINT "ai_job_events_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_jobs" ADD CONSTRAINT "ai_jobs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_requests" ADD CONSTRAINT "data_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_inputs" ADD CONSTRAINT "generation_inputs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_inputs" ADD CONSTRAINT "generation_inputs_job_id_ai_jobs_id_fk" FOREIGN KEY ("job_id") REFERENCES "public"."ai_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "api_keys_hash_unq" ON "api_keys" USING btree ("key_hash");--> statement-breakpoint
CREATE INDEX "api_keys_tenant_idx" ON "api_keys" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "audit_tenant_time_idx" ON "audit_logs" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_resource_idx" ON "audit_logs" USING btree ("tenant_id","resource_type","resource_id");--> statement-breakpoint
CREATE INDEX "invitations_tenant_idx" ON "invitations" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invitations_token_unq" ON "invitations" USING btree ("token_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "refresh_tokens_hash_unq" ON "refresh_tokens" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "refresh_tokens_session_idx" ON "refresh_tokens" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_tenant_user_unq" ON "tenant_memberships" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "tenant_memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_unq" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tenants_status_idx" ON "tenants" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_unq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "verification_purpose_idx" ON "verification_tokens" USING btree ("purpose","token_hash");--> statement-breakpoint
CREATE INDEX "verification_user_idx" ON "verification_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "billing_events_provider_event_unq" ON "billing_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "credit_ledger_tenant_idx" ON "credit_ledger" USING btree ("tenant_id","created_at");--> statement-breakpoint
CREATE INDEX "invoice_lines_invoice_idx" ON "invoice_lines" USING btree ("invoice_id");--> statement-breakpoint
CREATE UNIQUE INDEX "invoices_number_unq" ON "invoices" USING btree ("invoice_number");--> statement-breakpoint
CREATE INDEX "invoices_tenant_idx" ON "invoices" USING btree ("tenant_id","status","issued_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_provider_id_unq" ON "payments" USING btree ("provider_payment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_idempotency_unq" ON "payments" USING btree ("idempotency_key");--> statement-breakpoint
CREATE INDEX "payments_tenant_idx" ON "payments" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_code_unq" ON "plans" USING btree ("code");--> statement-breakpoint
CREATE INDEX "sub_changes_sub_idx" ON "subscription_changes" USING btree ("subscription_id");--> statement-breakpoint
CREATE INDEX "subscriptions_tenant_idx" ON "subscriptions" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "categories_tenant_slug_unq" ON "categories" USING btree ("tenant_id","slug");--> statement-breakpoint
CREATE INDEX "field_mappings_connection_idx" ON "field_mappings" USING btree ("connection_id");--> statement-breakpoint
CREATE INDEX "variants_product_idx" ON "product_variants" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "products_tenant_connection_external_unq" ON "products" USING btree ("tenant_id","connection_id","external_id");--> statement-breakpoint
CREATE INDEX "products_tenant_status_idx" ON "products" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "products_tenant_ar_idx" ON "products" USING btree ("tenant_id","ar_enabled");--> statement-breakpoint
CREATE INDEX "products_tenant_name_idx" ON "products" USING btree ("tenant_id","name");--> statement-breakpoint
CREATE UNIQUE INDEX "connections_provider_store_unq" ON "store_connections" USING btree ("provider","external_store_id");--> statement-breakpoint
CREATE INDEX "connections_tenant_idx" ON "store_connections" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "sync_items_job_idx" ON "sync_job_items" USING btree ("sync_job_id","action");--> statement-breakpoint
CREATE INDEX "sync_jobs_tenant_idx" ON "sync_jobs" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_provider_event_unq" ON "webhook_events" USING btree ("provider","provider_event_id");--> statement-breakpoint
CREATE INDEX "webhook_events_status_idx" ON "webhook_events" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "ar_configs_product_unq" ON "ar_configs" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "hosted_pages_slug_unq" ON "hosted_pages" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "model_files_version_idx" ON "model_files" USING btree ("model_version_id","format","variant");--> statement-breakpoint
CREATE UNIQUE INDEX "model_versions_model_version_unq" ON "model_versions" USING btree ("model_id","version");--> statement-breakpoint
CREATE INDEX "models_tenant_idx" ON "models_3d" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE INDEX "models_product_idx" ON "models_3d" USING btree ("product_id");--> statement-breakpoint
CREATE UNIQUE INDEX "qr_codes_code_unq" ON "qr_codes" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "tryon_configs_product_unq" ON "tryon_configs" USING btree ("product_id");--> statement-breakpoint
CREATE INDEX "ai_job_events_job_idx" ON "ai_job_events" USING btree ("job_id","created_at");--> statement-breakpoint
CREATE INDEX "ai_jobs_tenant_idx" ON "ai_jobs" USING btree ("tenant_id","status","created_at");--> statement-breakpoint
CREATE INDEX "ai_jobs_type_idx" ON "ai_jobs" USING btree ("type","status");--> statement-breakpoint
CREATE INDEX "data_requests_tenant_idx" ON "data_requests" USING btree ("tenant_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "feature_flags_key_tenant_unq" ON "feature_flags" USING btree ("key","tenant_id");--> statement-breakpoint
CREATE INDEX "generation_inputs_job_idx" ON "generation_inputs" USING btree ("job_id");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("queue","state","run_after","priority");--> statement-breakpoint
CREATE INDEX "jobs_tenant_idx" ON "jobs" USING btree ("tenant_id","state");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_dedupe_unq" ON "jobs" USING btree ("dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "model_registry_name_version_unq" ON "model_registry" USING btree ("name","version");--> statement-breakpoint
CREATE INDEX "notifications_tenant_user_idx" ON "notifications" USING btree ("tenant_id","user_id","read_at");--> statement-breakpoint
CREATE INDEX "events_tenant_type_time_idx" ON "analytics_events" USING btree ("tenant_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "events_session_idx" ON "analytics_events" USING btree ("session_id");
-- ROLLBACK:
-- Drops everything this migration created, in reverse creation order.
-- DROP TABLE IF EXISTS "device_breakdown_daily" CASCADE;
-- DROP TABLE IF EXISTS "daily_tenant_stats" CASCADE;
-- DROP TABLE IF EXISTS "daily_product_stats" CASCADE;
-- DROP TABLE IF EXISTS "conversion_daily" CASCADE;
-- DROP TABLE IF EXISTS "analytics_events" CASCADE;
-- DROP TABLE IF EXISTS "notifications" CASCADE;
-- DROP TABLE IF EXISTS "model_registry" CASCADE;
-- DROP TABLE IF EXISTS "jobs" CASCADE;
-- DROP TABLE IF EXISTS "generation_inputs" CASCADE;
-- DROP TABLE IF EXISTS "feature_flags" CASCADE;
-- DROP TABLE IF EXISTS "data_requests" CASCADE;
-- DROP TABLE IF EXISTS "ai_jobs" CASCADE;
-- DROP TABLE IF EXISTS "ai_job_events" CASCADE;
-- DROP TABLE IF EXISTS "tryon_configs" CASCADE;
-- DROP TABLE IF EXISTS "qr_codes" CASCADE;
-- DROP TABLE IF EXISTS "models_3d" CASCADE;
-- DROP TABLE IF EXISTS "model_versions" CASCADE;
-- DROP TABLE IF EXISTS "model_files" CASCADE;
-- DROP TABLE IF EXISTS "hosted_pages" CASCADE;
-- DROP TABLE IF EXISTS "ar_configs" CASCADE;
-- DROP TABLE IF EXISTS "webhook_events" CASCADE;
-- DROP TABLE IF EXISTS "sync_jobs" CASCADE;
-- DROP TABLE IF EXISTS "sync_job_items" CASCADE;
-- DROP TABLE IF EXISTS "store_connections" CASCADE;
-- DROP TABLE IF EXISTS "products" CASCADE;
-- DROP TABLE IF EXISTS "product_variants" CASCADE;
-- DROP TABLE IF EXISTS "field_mappings" CASCADE;
-- DROP TABLE IF EXISTS "categories" CASCADE;
-- DROP TABLE IF EXISTS "usage_counters" CASCADE;
-- DROP TABLE IF EXISTS "subscriptions" CASCADE;
-- DROP TABLE IF EXISTS "subscription_changes" CASCADE;
-- DROP TABLE IF EXISTS "plans" CASCADE;
-- DROP TABLE IF EXISTS "plan_limits" CASCADE;
-- DROP TABLE IF EXISTS "plan_features" CASCADE;
-- DROP TABLE IF EXISTS "payments" CASCADE;
-- DROP TABLE IF EXISTS "invoices" CASCADE;
-- DROP TABLE IF EXISTS "invoice_sequences" CASCADE;
-- DROP TABLE IF EXISTS "invoice_lines" CASCADE;
-- DROP TABLE IF EXISTS "credit_ledger" CASCADE;
-- DROP TABLE IF EXISTS "billing_events" CASCADE;
-- DROP TABLE IF EXISTS "verification_tokens" CASCADE;
-- DROP TABLE IF EXISTS "users" CASCADE;
-- DROP TABLE IF EXISTS "tenants" CASCADE;
-- DROP TABLE IF EXISTS "tenant_settings" CASCADE;
-- DROP TABLE IF EXISTS "tenant_memberships" CASCADE;
-- DROP TABLE IF EXISTS "sessions" CASCADE;
-- DROP TABLE IF EXISTS "refresh_tokens" CASCADE;
-- DROP TABLE IF EXISTS "invitations" CASCADE;
-- DROP TABLE IF EXISTS "audit_logs" CASCADE;
-- DROP TABLE IF EXISTS "api_keys" CASCADE;
-- DROP TYPE IF EXISTS "event_type";
-- DROP TYPE IF EXISTS "device_type";
-- DROP TYPE IF EXISTS "notification_level";
-- DROP TYPE IF EXISTS "job_state";
-- DROP TYPE IF EXISTS "generation_angle";
-- DROP TYPE IF EXISTS "data_request_type";
-- DROP TYPE IF EXISTS "data_request_status";
-- DROP TYPE IF EXISTS "ai_job_type";
-- DROP TYPE IF EXISTS "ai_job_status";
-- DROP TYPE IF EXISTS "tryon_category";
-- DROP TYPE IF EXISTS "qa_status";
-- DROP TYPE IF EXISTS "model_variant";
-- DROP TYPE IF EXISTS "model_status";
-- DROP TYPE IF EXISTS "model_source";
-- DROP TYPE IF EXISTS "model_format";
-- DROP TYPE IF EXISTS "compression";
-- DROP TYPE IF EXISTS "ar_placement";
-- DROP TYPE IF EXISTS "webhook_status";
-- DROP TYPE IF EXISTS "sync_type";
-- DROP TYPE IF EXISTS "sync_trigger";
-- DROP TYPE IF EXISTS "sync_item_action";
-- DROP TYPE IF EXISTS "provider";
-- DROP TYPE IF EXISTS "product_status";
-- DROP TYPE IF EXISTS "job_status";
-- DROP TYPE IF EXISTS "connection_status";
-- DROP TYPE IF EXISTS "zatca_status";
-- DROP TYPE IF EXISTS "subscription_status";
-- DROP TYPE IF EXISTS "plan_code";
-- DROP TYPE IF EXISTS "payment_status";
-- DROP TYPE IF EXISTS "payment_method_kind";
-- DROP TYPE IF EXISTS "limit_key";
-- DROP TYPE IF EXISTS "invoice_status";
-- DROP TYPE IF EXISTS "credit_reason";
-- DROP TYPE IF EXISTS "subscription_change_type";
-- DROP TYPE IF EXISTS "billing_cycle";
-- DROP TYPE IF EXISTS "verification_purpose";
-- DROP TYPE IF EXISTS "tenant_status";
-- DROP TYPE IF EXISTS "tenant_goal";
-- DROP TYPE IF EXISTS "revoked_reason";
-- DROP TYPE IF EXISTS "product_category";
-- DROP TYPE IF EXISTS "membership_status";
-- DROP TYPE IF EXISTS "member_role";
-- DROP TYPE IF EXISTS "locale";
-- DROP TYPE IF EXISTS "actor_type";
