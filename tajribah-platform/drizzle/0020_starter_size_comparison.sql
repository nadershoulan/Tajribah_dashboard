-- T33 (Nader, 2026-09-28): every plan gets the try-on studio's on-the-model view and true-size
-- comparison, as the website promises; trying it on the shopper's own photo ("on me",
-- `virtual_tryon`) stays with Pro and up. Starter gains `size_comparison` (Growth and up had it).
INSERT INTO "plan_features" ("plan_id", "feature_key", "enabled")
SELECT p."id", 'size_comparison', true FROM "plans" p
WHERE p."code" = 'starter'
  AND NOT EXISTS (SELECT 1 FROM "plan_features" f WHERE f."plan_id" = p."id" AND f."feature_key" = 'size_comparison');

-- ROLLBACK:
-- DELETE FROM "plan_features" WHERE "feature_key" = 'size_comparison' AND "plan_id" IN (SELECT "id" FROM "plans" WHERE "code" = 'starter');
