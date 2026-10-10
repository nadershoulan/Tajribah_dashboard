-- T129 (Nader, 2026-10-10): pay for a plan by bank transfer, reviewed by staff; and the payment methods staff
-- switch on and off.
--  - payment_method_settings: one row per method of lib/payment-methods.ts — offered or not, order, settings.
--    Bank transfer starts on (it is offered once staff add a bank account); the gateway methods start off and
--    cannot be switched on until their gateway is wired.
--  - bank_accounts: Tajribah's accounts that stores transfer to (IBAN checked before it is saved).
--  - bank_transfer_requests: a store's request, the amounts as quoted, the account shown, the sender, the receipt,
--    staff's decision. One open request per store (partial unique index).
--  - bank_transfer_events: the request's timeline; append-only for the application role.
-- Expand-only: new enums, new tables, seed rows; nothing the running version reads.
CREATE TYPE "public"."bank_transfer_status" AS ENUM('pending', 'info_requested', 'approved', 'rejected', 'cancelled');
--> statement-breakpoint
CREATE TYPE "public"."bank_transfer_event" AS ENUM('submitted', 'info_requested', 'resubmitted', 'approved', 'rejected', 'cancelled', 'note');
--> statement-breakpoint
CREATE TABLE "payment_method_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"config" jsonb,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "bank_accounts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"bank_name" text NOT NULL,
	"bank_name_ar" text NOT NULL,
	"account_holder" text NOT NULL,
	"account_number" text NOT NULL,
	"iban" text NOT NULL,
	"swift" text,
	"currency" char(3) DEFAULT 'SAR' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_accounts_iban_unq" ON "bank_accounts" USING btree ("iban");
--> statement-breakpoint
CREATE TABLE "bank_transfer_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"reference" text NOT NULL,
	"status" "bank_transfer_status" DEFAULT 'pending' NOT NULL,
	"plan_id" uuid NOT NULL,
	"plan_code" "plan_code" NOT NULL,
	"billing_cycle" "billing_cycle" NOT NULL,
	"unit_price_minor" integer NOT NULL,
	"discount_minor" integer DEFAULT 0 NOT NULL,
	"coupon_code" text,
	"free_months" integer DEFAULT 0 NOT NULL,
	"coupon_redemption_id" uuid,
	"subtotal_minor" integer NOT NULL,
	"vat_minor" integer NOT NULL,
	"total_minor" integer NOT NULL,
	"currency" char(3) DEFAULT 'SAR' NOT NULL,
	"bank_account_id" uuid NOT NULL,
	"bank_snapshot" jsonb NOT NULL,
	"sender_name" text NOT NULL,
	"sender_bank" text,
	"transferred_on" text,
	"receipt_key" text,
	"receipt_type" text,
	"receipt_bytes" integer,
	"receipt_name" text,
	"buyer_company" boolean DEFAULT false NOT NULL,
	"buyer_name" text,
	"buyer_vat_number" text,
	"buyer_cr_number" text,
	"merchant_note" text,
	"decision_message" text,
	"staff_note" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"submitted_by" uuid NOT NULL,
	"subscription_id" uuid,
	"invoice_id" uuid,
	"payment_id" uuid,
	"period_start" timestamp with time zone,
	"period_end" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_transfer_requests" ADD CONSTRAINT "bank_transfer_requests_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_transfer_requests" ADD CONSTRAINT "bank_transfer_requests_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE no action ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_transfer_requests" ADD CONSTRAINT "bank_transfer_requests_bank_account_id_bank_accounts_id_fk" FOREIGN KEY ("bank_account_id") REFERENCES "public"."bank_accounts"("id") ON DELETE restrict ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transfer_reference_unq" ON "bank_transfer_requests" USING btree ("reference");
--> statement-breakpoint
CREATE UNIQUE INDEX "bank_transfer_one_open_unq" ON "bank_transfer_requests" USING btree ("tenant_id") WHERE "bank_transfer_requests"."status" in ('pending', 'info_requested');
--> statement-breakpoint
CREATE INDEX "bank_transfer_status_idx" ON "bank_transfer_requests" USING btree ("status","created_at");
--> statement-breakpoint
CREATE INDEX "bank_transfer_tenant_idx" ON "bank_transfer_requests" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE TABLE "bank_transfer_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"tenant_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"type" "bank_transfer_event" NOT NULL,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"message" text,
	"internal" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bank_transfer_events" ADD CONSTRAINT "bank_transfer_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "bank_transfer_events" ADD CONSTRAINT "bank_transfer_events_request_id_bank_transfer_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."bank_transfer_requests"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "bank_transfer_events_request_idx" ON "bank_transfer_events" USING btree ("request_id","created_at");
--> statement-breakpoint
INSERT INTO "payment_method_settings" ("key", "enabled", "sort_order") VALUES
	('bank_transfer', true, 10), ('mada', false, 20), ('card', false, 30), ('applepay', false, 40),
	('stcpay', false, 50), ('tamara', false, 60), ('tabby', false, 70)
ON CONFLICT ("key") DO NOTHING;

--> statement-breakpoint
-- rls:begin — GENERATED by scripts/gen-rls.mjs from db/schema; do not hand-edit
--> statement-breakpoint
ALTER TABLE "bank_transfer_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_transfer_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bank_transfer_events"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT ON "bank_transfer_events" TO tajribah_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_transfer_events" TO tajribah_admin;
--> statement-breakpoint
ALTER TABLE "bank_transfer_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bank_transfer_requests" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "bank_transfer_requests"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_transfer_requests" TO tajribah_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_transfer_requests" TO tajribah_admin;
--> statement-breakpoint
-- "bank_accounts": no tenant column and no app grant — admin role only (EXEMPT).
GRANT SELECT, INSERT, UPDATE, DELETE ON "bank_accounts" TO tajribah_admin;
--> statement-breakpoint
-- "payment_method_settings": no tenant column and no app grant — admin role only (EXEMPT).
GRANT SELECT, INSERT, UPDATE, DELETE ON "payment_method_settings" TO tajribah_admin;
-- rls:end

-- ROLLBACK:
-- DROP TABLE IF EXISTS "bank_transfer_events";
-- DROP TABLE IF EXISTS "bank_transfer_requests";
-- DROP TABLE IF EXISTS "bank_accounts";
-- DROP TABLE IF EXISTS "payment_method_settings";
-- DROP TYPE IF EXISTS "public"."bank_transfer_event";
-- DROP TYPE IF EXISTS "public"."bank_transfer_status";
