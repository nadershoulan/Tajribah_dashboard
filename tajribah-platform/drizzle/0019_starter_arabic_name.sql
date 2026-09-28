-- T32 (Nader, 2026-09-28): the Starter plan's Arabic name is «البداية» everywhere — the website
-- already used it, the dashboard said «المبتدئة». Only the catalogue row 0006 seeded changes: a
-- name staff have edited since is left alone. Issued invoices keep the lines they were issued with.
UPDATE "plans" SET "name_ar" = 'البداية' WHERE "code" = 'starter' AND "name_ar" = 'المبتدئة';

-- ROLLBACK:
-- UPDATE "plans" SET "name_ar" = 'المبتدئة' WHERE "code" = 'starter' AND "name_ar" = 'البداية';
