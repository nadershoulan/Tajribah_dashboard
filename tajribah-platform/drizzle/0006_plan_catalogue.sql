-- P2.1: the plan catalogue as rows. Until now nothing outside the tests inserted a plan, so on a
-- real database no subscription could be created (plan_id has nowhere to point) and quotas were
-- read from code, leaving plan_limits / plan_features unused.
--
-- The rows below are lib/plans.ts, written out. A test (server/core/billing/__tests__/
-- catalogue.test.ts) compares the migrated database with lib/plans.ts, so a change to one
-- without a new migration for the other fails the suite. Later price or limit changes are new
-- migrations — never edits to this one.
--
-- Enterprise has no list price ("talk to us"); storing 0 would be a made-up number, so the
-- price columns allow NULL.
ALTER TABLE "plans" ALTER COLUMN "price_monthly_minor" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "plans" ALTER COLUMN "price_annual_minor" DROP NOT NULL;
--> statement-breakpoint
INSERT INTO "plans" ("id", "code", "name", "name_ar", "price_monthly_minor", "price_annual_minor", "currency", "is_public", "sort_order") VALUES
  (gen_random_uuid(), 'starter', 'Starter', 'المبتدئة', 9900, 99000, 'SAR', true, 1),
  (gen_random_uuid(), 'growth', 'Growth', 'النمو', 29900, 299000, 'SAR', true, 2),
  (gen_random_uuid(), 'pro', 'Pro', 'الاحترافية', 99900, 999000, 'SAR', true, 3),
  (gen_random_uuid(), 'enterprise', 'Enterprise', 'المؤسسات', NULL, NULL, 'SAR', true, 4);
--> statement-breakpoint
INSERT INTO "plan_limits" ("plan_id", "key", "value")
SELECT p.id, l.key::limit_key, l.value FROM "plans" p JOIN (VALUES
  ('starter', 'products', 20), ('starter', 'ai_credits', 5), ('starter', 'storage_gb', 2),
  ('starter', 'ar_sessions', 5000), ('starter', 'team_members', 2), ('starter', 'bandwidth_gb', 50),
  ('growth', 'products', 200), ('growth', 'ai_credits', 40), ('growth', 'storage_gb', 20),
  ('growth', 'ar_sessions', 50000), ('growth', 'team_members', 5), ('growth', 'bandwidth_gb', 500),
  ('pro', 'products', -1), ('pro', 'ai_credits', 200), ('pro', 'storage_gb', 100),
  ('pro', 'ar_sessions', 250000), ('pro', 'team_members', 15), ('pro', 'bandwidth_gb', 2000),
  ('enterprise', 'products', -1), ('enterprise', 'ai_credits', -1), ('enterprise', 'storage_gb', -1),
  ('enterprise', 'ar_sessions', -1), ('enterprise', 'team_members', -1), ('enterprise', 'bandwidth_gb', -1)
) AS l(code, key, value) ON p.code::text = l.code;
--> statement-breakpoint
INSERT INTO "plan_features" ("plan_id", "feature_key", "enabled")
SELECT p.id, f.feature, true FROM "plans" p JOIN (VALUES
  ('starter', 'ar_viewer'), ('starter', 'hosted_pages'), ('starter', 'qr_codes'), ('starter', 'basic_analytics'),
  ('growth', 'ar_viewer'), ('growth', 'hosted_pages'), ('growth', 'qr_codes'), ('growth', 'size_comparison'),
  ('growth', 'full_analytics'), ('growth', 'salla'), ('growth', 'zid'),
  ('pro', 'ar_viewer'), ('pro', 'hosted_pages'), ('pro', 'qr_codes'), ('pro', 'size_comparison'),
  ('pro', 'full_analytics'), ('pro', 'salla'), ('pro', 'zid'), ('pro', 'shopify'), ('pro', 'woocommerce'),
  ('pro', 'virtual_tryon'), ('pro', 'ai_3d'), ('pro', 'recommendations'),
  ('enterprise', 'ar_viewer'), ('enterprise', 'hosted_pages'), ('enterprise', 'qr_codes'), ('enterprise', 'size_comparison'),
  ('enterprise', 'full_analytics'), ('enterprise', 'salla'), ('enterprise', 'zid'), ('enterprise', 'shopify'),
  ('enterprise', 'woocommerce'), ('enterprise', 'virtual_tryon'), ('enterprise', 'ai_3d'), ('enterprise', 'recommendations'),
  ('enterprise', 'white_label'), ('enterprise', 'public_api'), ('enterprise', 'sso'), ('enterprise', 'custom_roles'),
  ('enterprise', 'custom_domain'), ('enterprise', 'dedicated_support')
) AS f(code, feature) ON p.code::text = f.code;

-- ROLLBACK:
-- Only before any subscription points at these plans (subscriptions.plan_id has no cascade).
-- DELETE FROM "plan_features" WHERE "plan_id" IN (SELECT "id" FROM "plans" WHERE "code" IN ('starter', 'growth', 'pro', 'enterprise'));
-- DELETE FROM "plan_limits" WHERE "plan_id" IN (SELECT "id" FROM "plans" WHERE "code" IN ('starter', 'growth', 'pro', 'enterprise'));
-- DELETE FROM "plans" WHERE "code" IN ('starter', 'growth', 'pro', 'enterprise');
-- ALTER TABLE "plans" ALTER COLUMN "price_annual_minor" SET NOT NULL;
-- ALTER TABLE "plans" ALTER COLUMN "price_monthly_minor" SET NOT NULL;
