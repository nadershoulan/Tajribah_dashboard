-- When a stored webhook event may next be tried (filed under P1.7): a failed handler used to
-- be retried on the very next worker tick, so five attempts could go in five seconds. Null
-- means "now" — a first delivery, or one a person replayed.
ALTER TABLE "webhook_events" ADD COLUMN "next_attempt_at" timestamp with time zone;

-- ROLLBACK:
-- ALTER TABLE "webhook_events" DROP COLUMN IF EXISTS "next_attempt_at";
