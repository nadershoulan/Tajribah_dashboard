-- T126 (Nader, 2026-10-10): "on me" — the shopper tries the watch on their own photo, taken on their phone through
-- the QR scan (`virtual_tryon`) — on every plan, not only Pro and up (0020 kept it there). Starter and Growth
-- gain it. Production already has it from the staff Plans page the same day; this makes every database say so,
-- and running it again changes nothing.
UPDATE "plan_features" SET "enabled" = true
WHERE "feature_key" = 'virtual_tryon' AND "plan_id" IN (SELECT "id" FROM "plans" WHERE "code" IN ('starter', 'growth'));

INSERT INTO "plan_features" ("plan_id", "feature_key", "enabled")
SELECT p."id", 'virtual_tryon', true FROM "plans" p
WHERE p."code" IN ('starter', 'growth')
  AND NOT EXISTS (SELECT 1 FROM "plan_features" f WHERE f."plan_id" = p."id" AND f."feature_key" = 'virtual_tryon');

-- ROLLBACK:
-- DELETE FROM "plan_features" WHERE "feature_key" = 'virtual_tryon' AND "plan_id" IN (SELECT "id" FROM "plans" WHERE "code" IN ('starter', 'growth'));
