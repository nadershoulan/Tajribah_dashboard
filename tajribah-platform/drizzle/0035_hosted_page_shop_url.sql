-- P1.19: a product's own page. The merchant's link to buy the product in their shop, and one page per
-- product. `slug` stays for the short code the short domain will carry (P1.20); a page needs none
-- until then. Expand-only: one nullable column, a NOT NULL relaxed, one index.
ALTER TABLE "hosted_pages" ADD COLUMN "shop_url" text;
--> statement-breakpoint
ALTER TABLE "hosted_pages" ALTER COLUMN "slug" DROP NOT NULL;
--> statement-breakpoint
-- lock-ok: hosted_pages has had no writer until this change, so the table is empty everywhere.
CREATE UNIQUE INDEX "hosted_pages_product_unq" ON "hosted_pages" USING btree ("product_id");

-- ROLLBACK:
-- DROP INDEX IF EXISTS "hosted_pages_product_unq";
-- DELETE FROM "hosted_pages" WHERE "slug" IS NULL;
-- ALTER TABLE "hosted_pages" ALTER COLUMN "slug" SET NOT NULL;
-- ALTER TABLE "hosted_pages" DROP COLUMN IF EXISTS "shop_url";
