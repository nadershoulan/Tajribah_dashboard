-- P5.10: what the owner's try-on studio needs for a merchant's watch (T26) — the worn cut-out and
-- the flat shot (storage keys and sizes, counted against the plan's storage), the case width in
-- tenths of a millimetre, the finish line, and an on/off switch. tryon_configs already has its
-- RLS policy (0001); adding columns changes nothing there.
ALTER TABLE "tryon_configs" ADD COLUMN "worn_key" text;
--> statement-breakpoint
ALTER TABLE "tryon_configs" ADD COLUMN "worn_bytes" integer;
--> statement-breakpoint
ALTER TABLE "tryon_configs" ADD COLUMN "flat_key" text;
--> statement-breakpoint
ALTER TABLE "tryon_configs" ADD COLUMN "flat_bytes" integer;
--> statement-breakpoint
ALTER TABLE "tryon_configs" ADD COLUMN "case_tenths_mm" integer;
--> statement-breakpoint
ALTER TABLE "tryon_configs" ADD COLUMN "finish_ar" text;
--> statement-breakpoint
ALTER TABLE "tryon_configs" ADD COLUMN "finish_en" text;
--> statement-breakpoint
ALTER TABLE "tryon_configs" ADD COLUMN "enabled" boolean DEFAULT false NOT NULL;

-- ROLLBACK:
-- ALTER TABLE "tryon_configs" DROP COLUMN IF EXISTS "enabled";
-- ALTER TABLE "tryon_configs" DROP COLUMN IF EXISTS "finish_en";
-- ALTER TABLE "tryon_configs" DROP COLUMN IF EXISTS "finish_ar";
-- ALTER TABLE "tryon_configs" DROP COLUMN IF EXISTS "case_tenths_mm";
-- ALTER TABLE "tryon_configs" DROP COLUMN IF EXISTS "flat_bytes";
-- ALTER TABLE "tryon_configs" DROP COLUMN IF EXISTS "flat_key";
-- ALTER TABLE "tryon_configs" DROP COLUMN IF EXISTS "worn_bytes";
-- ALTER TABLE "tryon_configs" DROP COLUMN IF EXISTS "worn_key";
