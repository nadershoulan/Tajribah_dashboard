-- T68: professional models before card payments open — the merchant accepts the quote, our team
-- records the bank transfer, then delivers the model into the product. Expand-only: nullable columns.
ALTER TABLE "professional_orders" ADD COLUMN "accepted_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "professional_orders" ADD COLUMN "paid_at" timestamp with time zone;
--> statement-breakpoint
ALTER TABLE "professional_orders" ADD COLUMN "payment_reference" text;
--> statement-breakpoint
ALTER TABLE "professional_orders" ADD COLUMN "delivered_model_id" uuid;
--> statement-breakpoint
ALTER TABLE "professional_orders" ADD COLUMN "delivered_version_id" uuid;
--> statement-breakpoint
ALTER TABLE "professional_orders" ADD COLUMN "delivered_at" timestamp with time zone;

-- ROLLBACK:
-- ALTER TABLE "professional_orders" DROP COLUMN IF EXISTS "delivered_at";
-- ALTER TABLE "professional_orders" DROP COLUMN IF EXISTS "delivered_version_id";
-- ALTER TABLE "professional_orders" DROP COLUMN IF EXISTS "delivered_model_id";
-- ALTER TABLE "professional_orders" DROP COLUMN IF EXISTS "payment_reference";
-- ALTER TABLE "professional_orders" DROP COLUMN IF EXISTS "paid_at";
-- ALTER TABLE "professional_orders" DROP COLUMN IF EXISTS "accepted_at";
