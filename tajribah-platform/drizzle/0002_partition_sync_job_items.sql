-- P1.6b — `sync_job_items` partitioned by month (§7.11). Hand-written: Drizzle cannot declare
-- partitions, so `db/schema/commerce.ts` still describes the columns and this file the layout.
--
-- A table cannot be turned into a partitioned one in place, so it is rebuilt. Rebuilding drops
-- what 0001_rls.sql put on it, so this file re-applies the same RLS policy and grants —
-- `db/__tests__/partitions.test.ts` checks they match what the generator gives `sync_jobs`.
-- Grants in 0001 were `ON ALL TABLES` at the time it ran; a table created later has none.
--
-- Partitions: one per month, created ahead by `ensure_sync_job_items_partition(date)` (the
-- sync schedule calls it every tick for this month and the next two), plus a DEFAULT
-- partition so a missing month never loses a row. Only the parent is granted to the app:
-- a partition read directly is refused, so RLS on the parent cannot be walked around.
ALTER TABLE "sync_job_items" RENAME TO "sync_job_items_old";
ALTER TABLE "sync_job_items_old" RENAME CONSTRAINT "sync_job_items_pkey" TO "sync_job_items_old_pkey";
ALTER INDEX "sync_items_job_idx" RENAME TO "sync_items_job_idx_old";
--> statement-breakpoint
CREATE TABLE "sync_job_items" (
	"id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"sync_job_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"product_id" uuid,
	"action" "sync_item_action" NOT NULL,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	-- The partition key must be part of the primary key.
	CONSTRAINT "sync_job_items_pkey" PRIMARY KEY ("id", "created_at")
) PARTITION BY RANGE ("created_at");
--> statement-breakpoint
ALTER TABLE "sync_job_items" ADD CONSTRAINT "sync_job_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
ALTER TABLE "sync_job_items" ADD CONSTRAINT "sync_job_items_sync_job_id_sync_jobs_id_fk" FOREIGN KEY ("sync_job_id") REFERENCES "public"."sync_jobs"("id") ON DELETE cascade ON UPDATE no action;
CREATE INDEX "sync_items_job_idx" ON "sync_job_items" USING btree ("sync_job_id","action");
--> statement-breakpoint
CREATE TABLE "sync_job_items_default" PARTITION OF "sync_job_items" DEFAULT;
--> statement-breakpoint
CREATE FUNCTION ensure_sync_job_items_partition(month date) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  first date := date_trunc('month', month)::date;
  part text := format('sync_job_items_y%sm%s', to_char(first, 'YYYY'), to_char(first, 'MM'));
BEGIN
  IF to_regclass(part) IS NULL THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF sync_job_items FOR VALUES FROM (%L) TO (%L)',
      part, first, (first + interval '1 month')::date);
  END IF;
  RETURN part;
END $$;
REVOKE ALL ON FUNCTION ensure_sync_job_items_partition(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION ensure_sync_job_items_partition(date) TO tajribah_admin;
--> statement-breakpoint
-- This month and the next two exist before the old rows are copied, so current rows land in
-- their month rather than in DEFAULT (a month's partition cannot be created later while
-- DEFAULT holds rows for it).
SELECT ensure_sync_job_items_partition((now() + (n || ' month')::interval)::date) FROM generate_series(0, 2) AS n;
--> statement-breakpoint
INSERT INTO "sync_job_items" ("id", "tenant_id", "sync_job_id", "external_id", "product_id", "action", "error", "created_at")
  SELECT "id", "tenant_id", "sync_job_id", "external_id", "product_id", "action", "error", "created_at" FROM "sync_job_items_old";
DROP TABLE "sync_job_items_old";
--> statement-breakpoint
ALTER TABLE "sync_job_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "sync_job_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sync_job_items"
  USING (tenant_id = current_tenant_id())
  WITH CHECK (tenant_id = current_tenant_id());
GRANT SELECT, INSERT, UPDATE, DELETE ON "sync_job_items" TO tajribah_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "sync_job_items" TO tajribah_admin;

-- ROLLBACK:
-- Back to one unpartitioned table with the 0001 policy and grants, rows kept.
-- DROP FUNCTION IF EXISTS "ensure_sync_job_items_partition"(date);
-- CREATE TABLE "sync_job_items_flat" ("id" uuid PRIMARY KEY NOT NULL, "tenant_id" uuid NOT NULL, "sync_job_id" uuid NOT NULL, "external_id" text NOT NULL, "product_id" uuid, "action" "sync_item_action" NOT NULL, "error" text, "created_at" timestamp with time zone DEFAULT now() NOT NULL);
-- INSERT INTO "sync_job_items_flat" SELECT "id", "tenant_id", "sync_job_id", "external_id", "product_id", "action", "error", "created_at" FROM "sync_job_items";
-- DROP TABLE IF EXISTS "sync_job_items_default";
-- DROP TABLE IF EXISTS "sync_job_items" CASCADE;
-- ALTER TABLE "sync_job_items_flat" RENAME TO "sync_job_items";
-- ALTER TABLE "sync_job_items" RENAME CONSTRAINT "sync_job_items_flat_pkey" TO "sync_job_items_pkey";
-- ALTER TABLE "sync_job_items" ADD CONSTRAINT "sync_job_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade;
-- ALTER TABLE "sync_job_items" ADD CONSTRAINT "sync_job_items_sync_job_id_sync_jobs_id_fk" FOREIGN KEY ("sync_job_id") REFERENCES "public"."sync_jobs"("id") ON DELETE cascade;
-- CREATE INDEX "sync_items_job_idx" ON "sync_job_items" USING btree ("sync_job_id","action");
-- ALTER TABLE "sync_job_items" ENABLE ROW LEVEL SECURITY;
-- ALTER TABLE "sync_job_items" FORCE ROW LEVEL SECURITY;
-- CREATE POLICY tenant_isolation ON "sync_job_items" USING (tenant_id = current_tenant_id()) WITH CHECK (tenant_id = current_tenant_id());
-- GRANT SELECT, INSERT, UPDATE, DELETE ON "sync_job_items" TO tajribah_app;
-- GRANT SELECT, INSERT, UPDATE, DELETE ON "sync_job_items" TO tajribah_admin;
