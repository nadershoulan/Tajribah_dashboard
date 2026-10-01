-- P4.3: the roll-up reads one store's events of one day, of every type; the existing index leads with
-- the type after the store. Expand-only: one index.
-- CONCURRENTLY: analytics_events is written by the running version (outside a transaction, P7's runner).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "events_tenant_time_idx" ON "analytics_events" USING btree ("tenant_id","occurred_at");

-- ROLLBACK:
-- DROP INDEX IF EXISTS "events_tenant_time_idx";
