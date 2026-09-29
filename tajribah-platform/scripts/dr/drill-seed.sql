-- P7 — synthetic data for a restore drill on a scratch server: two stores, their people, products
-- and audit rows. Never run against a real database; never real data. Idempotent enough to rerun on a
-- fresh cluster (fixed ids).
insert into users (id, email, password_hash, full_name) values
  ('01a0f000-0000-7000-8000-000000000001', 'drill-a@example.test', 'x', 'Drill A'),
  ('01a0f000-0000-7000-8000-000000000002', 'drill-b@example.test', 'x', 'Drill B');
insert into tenants (id, slug, name) values
  ('01a0f000-0000-7000-8000-00000000000a', 'drill-a', 'Drill store A'),
  ('01a0f000-0000-7000-8000-00000000000b', 'drill-b', 'Drill store B');
insert into tenant_memberships (id, tenant_id, user_id, role, status) values
  ('01a0f000-0000-7000-8000-0000000000a1', '01a0f000-0000-7000-8000-00000000000a', '01a0f000-0000-7000-8000-000000000001', 'owner', 'active'),
  ('01a0f000-0000-7000-8000-0000000000b1', '01a0f000-0000-7000-8000-00000000000b', '01a0f000-0000-7000-8000-000000000002', 'owner', 'active');
insert into products (id, tenant_id, name, name_ar, status)
  select gen_random_uuid(), '01a0f000-0000-7000-8000-00000000000a', 'Product A' || n, 'منتج ' || n, 'active' from generate_series(1, 400) n;
insert into products (id, tenant_id, name, name_ar, status)
  select gen_random_uuid(), '01a0f000-0000-7000-8000-00000000000b', 'Product B' || n, 'منتج ب ' || n, 'draft' from generate_series(1, 250) n;
insert into audit_logs (id, tenant_id, actor_type, action, resource_type)
  select gen_random_uuid(), case when n % 2 = 0 then '01a0f000-0000-7000-8000-00000000000a'::uuid else '01a0f000-0000-7000-8000-00000000000b'::uuid end,
         'user', 'create', 'product' from generate_series(1, 1000) n;
