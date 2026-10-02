-- P3.8: a 3D model's picture — the view the merchant chose in the 3D editor, shown in the model list and
-- (once published) as the product page's link preview. Expand-only: two nullable columns.
ALTER TABLE "models_3d" ADD COLUMN "picture_key" text;
--> statement-breakpoint
ALTER TABLE "models_3d" ADD COLUMN "picture_bytes" integer;

-- ROLLBACK:
-- ALTER TABLE "models_3d" DROP COLUMN IF EXISTS "picture_bytes";
-- ALTER TABLE "models_3d" DROP COLUMN IF EXISTS "picture_key";
