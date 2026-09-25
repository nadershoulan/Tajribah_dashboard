-- Why a model version failed, on the row (filed under P1.13): the file check's reason, the
-- optimiser's, or "upload never confirmed" from the draft sweep. Until now it lived only in
-- the audit trail and the log, which the model library cannot show. Null unless `failed`.
ALTER TABLE "model_versions" ADD COLUMN "error" text;

-- ROLLBACK:
-- ALTER TABLE "model_versions" DROP COLUMN IF EXISTS "error";
