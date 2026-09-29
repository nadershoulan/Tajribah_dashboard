-- P6 model registry & A/B: each registered model names the kind of AI work it does, so new jobs
-- of that type are split among its active models. Expand-only: a nullable column on a small
-- platform catalogue (read-only to the app role; written by the admin console).
ALTER TABLE "model_registry" ADD COLUMN "job_type" "ai_job_type";

-- ROLLBACK:
-- ALTER TABLE "model_registry" DROP COLUMN IF EXISTS "job_type";
