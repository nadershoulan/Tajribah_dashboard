-- T67 follow-up: when a product is published or taken down, the products that list it as "often viewed
-- together" are refreshed at once (server/modules/edge/publish.ts) — found by the product they list.
-- Expand-only: one index. CONCURRENTLY: product_relations is written by the running version's nightly sweep.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "product_relations_related_idx" ON "product_relations" USING btree ("tenant_id","related_product_id");

-- ROLLBACK:
-- DROP INDEX IF EXISTS "product_relations_related_idx";
