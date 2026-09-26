-- A14 (T22): data_requests becomes the privacy-request register. A person's request about their
-- own account belongs to no store, so the store is optional (the tenant policy stays: a row with
-- no store is invisible to the app role and read by the admin console only). Who the request is
-- about, when it is due (30 days), and which staff member handled it.
ALTER TABLE "data_requests" ALTER COLUMN "tenant_id" DROP NOT NULL;
ALTER TABLE "data_requests" ADD COLUMN "subject_user_id" uuid;
ALTER TABLE "data_requests" ADD COLUMN "due_at" timestamp with time zone;
ALTER TABLE "data_requests" ADD COLUMN "handled_by" uuid;
ALTER TABLE "data_requests" ADD COLUMN "identity_check" text;

-- ROLLBACK:
-- ALTER TABLE "data_requests" DROP COLUMN IF EXISTS "identity_check";
-- ALTER TABLE "data_requests" DROP COLUMN IF EXISTS "handled_by";
-- ALTER TABLE "data_requests" DROP COLUMN IF EXISTS "due_at";
-- ALTER TABLE "data_requests" DROP COLUMN IF EXISTS "subject_user_id";
-- DELETE FROM "data_requests" WHERE "tenant_id" IS NULL;
-- ALTER TABLE "data_requests" ALTER COLUMN "tenant_id" SET NOT NULL;
