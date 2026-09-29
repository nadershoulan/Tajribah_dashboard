-- P7 database performance: an index for every list a screen reads that had none serving both its
-- filter and its order (db/__tests__/hot-queries.test.ts checks each plan). CONCURRENTLY: every
-- table here is written by the running version; outside a transaction (P7's runner). Expand-only.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "products_tenant_id_idx" ON "products" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ai_jobs_tenant_id_idx" ON "ai_jobs" USING btree ("tenant_id","id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "notifications_tenant_user_time_idx" ON "notifications" USING btree ("tenant_id","user_id","created_at");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "sync_jobs_connection_idx" ON "sync_jobs" USING btree ("connection_id","id");
--> statement-breakpoint
CREATE INDEX CONCURRENTLY IF NOT EXISTS "webhook_events_connection_idx" ON "webhook_events" USING btree ("connection_id","created_at");

-- ROLLBACK:
-- DROP INDEX CONCURRENTLY IF EXISTS "webhook_events_connection_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "sync_jobs_connection_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "notifications_tenant_user_time_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "ai_jobs_tenant_id_idx";
-- DROP INDEX CONCURRENTLY IF EXISTS "products_tenant_id_idx";
