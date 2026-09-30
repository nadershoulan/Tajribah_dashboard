-- Found on 2026-10-01 (00:42 in Riyadh, still 30 September in UTC): the month partitions of
-- sync_job_items were bounded in the database session's time zone, while the app counts months in
-- UTC (`ensureSyncItemPartitions`). Near a month's turn, rows could land in a partition the app did
-- not expect. Two fixes, both expand-only:
--  1. the partition function writes its bounds as UTC instants, whatever the session's zone;
--  2. the database's sessions run in UTC from now on (the app's times are all UTC).
-- Partitions made before this keep their bounds; for a zone east of UTC (Saudi Arabia) the next UTC
-- month starts after the old one ends, so the few hours between fall to the DEFAULT partition.
CREATE OR REPLACE FUNCTION ensure_sync_job_items_partition(month date) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  first date := date_trunc('month', month)::date;
  part text := format('sync_job_items_y%sm%s', to_char(first, 'YYYY'), to_char(first, 'MM'));
BEGIN
  IF to_regclass(part) IS NULL THEN
    EXECUTE format('CREATE TABLE %I PARTITION OF sync_job_items FOR VALUES FROM (%L) TO (%L)',
      part, first::timestamp AT TIME ZONE 'UTC', (first + interval '1 month')::timestamp AT TIME ZONE 'UTC');
  END IF;
  RETURN part;
END $$;
--> statement-breakpoint
DO $$ BEGIN EXECUTE format('ALTER DATABASE %I SET timezone TO %L', current_database(), 'UTC'); END $$;

-- ROLLBACK:
-- DO $$ BEGIN EXECUTE format('ALTER DATABASE %I RESET timezone', current_database()); END $$;
-- CREATE OR REPLACE FUNCTION ensure_sync_job_items_partition(month date) RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$ DECLARE first date := date_trunc('month', month)::date; part text := format('sync_job_items_y%sm%s', to_char(first, 'YYYY'), to_char(first, 'MM')); BEGIN IF to_regclass(part) IS NULL THEN EXECUTE format('CREATE TABLE %I PARTITION OF sync_job_items FOR VALUES FROM (%L) TO (%L)', part, first, (first + interval '1 month')::date); END IF; RETURN part; END $$;
