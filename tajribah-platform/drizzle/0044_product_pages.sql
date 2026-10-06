-- T95: the button on every product page through Google Tag Manager (Salla). A page-wide tag knows the page's
-- address, not the product's id in the feed, so:
--  - products.page_url: the product's page in the store, as its feed gives it (`link`). The sync fills it.
--  - edge_configs.page_key: the second address a published config is written at — the ref of that page
--    (`page:p1412564664`, widget/src/auto.ts) — kept so it is deleted with the config, even after the page moved.
-- Expand-only: two nullable columns, unread by the running version.
ALTER TABLE "products" ADD COLUMN "page_url" text;
--> statement-breakpoint
ALTER TABLE "edge_configs" ADD COLUMN "page_key" text;

-- ROLLBACK:
-- Configs written at a page key stay in the config store until their product is published or taken down
-- again by a version that knows them; the shop's button then simply stops finding them (it fails closed).
-- ALTER TABLE "edge_configs" DROP COLUMN IF EXISTS "page_key";
-- ALTER TABLE "products" DROP COLUMN IF EXISTS "page_url";
