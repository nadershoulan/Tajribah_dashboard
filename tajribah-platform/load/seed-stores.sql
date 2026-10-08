-- P7 load test 2 (event ingest) — test stores for STAGING ONLY (database tajribah_staging).
--
-- The collector limits each store to 60 batches a minute from one address, so one machine reaching
-- 3,000 events a second (150 batches a second) needs at least 150 stores; 200 leaves room.
-- Store keys are the slugs load-001 … load-200 (status trial, so the collector serves them).
--
--   ssh tajribah "sudo -u postgres psql -d tajribah_staging -v ON_ERROR_STOP=1" < load/seed-stores.sql
--
-- Never run against the production database.
do $$ begin
  if current_database() <> 'tajribah_staging' then raise exception 'load stores go on tajribah_staging only, not %', current_database(); end if;
end $$;

insert into tenants (id, slug, name)
select uuidv7(), 'load-' || lpad(g::text, 3, '0'), 'Load test ' || g
from generate_series(1, 200) g
on conflict (slug) do nothing;

select count(*) as load_stores from tenants where slug like 'load-%';

-- ROLLBACK (after the run): the stores and everything the run wrote for them.
-- delete from analytics_events where tenant_id in (select id from tenants where slug like 'load-%');
-- delete from jobs where tenant_id in (select id from tenants where slug like 'load-%');
-- delete from tenants where slug like 'load-%';
