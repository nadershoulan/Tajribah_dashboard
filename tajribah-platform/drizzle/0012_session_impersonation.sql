-- A4b: staff viewing one store's dashboard, read-only, for a limited time. It is the staff
-- member's own session pointed at the store (the session, never a header, decides the store),
-- with when the view ends and the store to return to. Null on every other session.
ALTER TABLE "sessions" ADD COLUMN "impersonating_until" timestamp with time zone;
ALTER TABLE "sessions" ADD COLUMN "impersonation_return_tenant_id" uuid;

-- ROLLBACK:
-- ALTER TABLE "sessions" DROP COLUMN IF EXISTS "impersonation_return_tenant_id";
-- ALTER TABLE "sessions" DROP COLUMN IF EXISTS "impersonating_until";
