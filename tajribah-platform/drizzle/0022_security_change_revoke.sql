-- T47: turning two-step sign-in on ends the account's other sessions (a session taken before it was
-- turned on must not outlive it). Their revoke reason is its own, not "password_change". Adding an
-- enum value is expand-only: the running version never writes it and reads it as an unknown string.
ALTER TYPE "public"."revoked_reason" ADD VALUE IF NOT EXISTS 'security_change';

-- ROLLBACK:
-- Postgres cannot drop an enum value; the value stays, unused. Sessions revoked with it keep a reason
-- the older code knows.
-- UPDATE "sessions" SET "revoked_reason" = 'admin' WHERE "revoked_reason" = 'security_change';
