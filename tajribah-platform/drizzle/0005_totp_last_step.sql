-- P1.2b: the last authenticator time step accepted for a user. A code is refused if its step
-- is not newer, so a code seen over a shoulder cannot be used again inside its 30 seconds.
-- Null until the first code is accepted. `users` is not tenant data: no RLS change.
ALTER TABLE "users" ADD COLUMN "totp_last_step" integer;

-- ROLLBACK:
-- ALTER TABLE "users" DROP COLUMN IF EXISTS "totp_last_step";
