-- P2.9: every AI-credit entry names what caused it (an AI job, a payment, a period's plan
-- grant). One row per reference per store: a retried job is charged once, a grant is made
-- once per period, a refund happens once. The service checks first under a lock on the store;
-- this index is what makes a double entry impossible rather than unlikely.
--
-- The ledger also became append-only for the app role (db/schema/index.ts APPEND_ONLY →
-- drizzle/0001_rls.sql grants SELECT, INSERT only), like audit_logs.
CREATE UNIQUE INDEX "credit_ledger_reference_unq" ON "credit_ledger" ("tenant_id", "reference_type", "reference_id") WHERE "reference_id" IS NOT NULL;

-- ROLLBACK:
-- DROP INDEX IF EXISTS "credit_ledger_reference_unq";
