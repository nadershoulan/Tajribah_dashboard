-- T62: where a store's own address is switched on — the custom hostname's id at Cloudflare for SaaS.
-- Expand-only: one nullable column.
ALTER TABLE "custom_domains" ADD COLUMN "provider_id" text;

-- ROLLBACK:
-- ALTER TABLE "custom_domains" DROP COLUMN IF EXISTS "provider_id";
