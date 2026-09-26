-- P2.6 (completed 2026-09-27): SRO Company's National Address is now known. A Saudi tax invoice
-- is read in Arabic, so the seller's address is snapshotted in both languages at issue.
ALTER TABLE "invoices" ADD COLUMN "seller_address_ar" text;

-- ROLLBACK:
-- ALTER TABLE "invoices" DROP COLUMN IF EXISTS "seller_address_ar";
