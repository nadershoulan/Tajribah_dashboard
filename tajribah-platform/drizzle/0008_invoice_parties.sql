-- P2.6: an invoice is a legal document; it must read tomorrow exactly as it read when issued.
-- Seller and buyer are snapshotted onto the row at issue — a store renaming itself or the
-- seller's details changing later never rewrites an invoice already sent. The buyer's VAT and
-- CR numbers were already columns; these complete both parties.
ALTER TABLE "invoices" ADD COLUMN "seller_name" text;
ALTER TABLE "invoices" ADD COLUMN "seller_name_ar" text;
ALTER TABLE "invoices" ADD COLUMN "seller_cr_number" text;
ALTER TABLE "invoices" ADD COLUMN "seller_vat_number" text;
ALTER TABLE "invoices" ADD COLUMN "seller_address" text;
ALTER TABLE "invoices" ADD COLUMN "buyer_name" text;
ALTER TABLE "invoices" ADD COLUMN "buyer_name_ar" text;
ALTER TABLE "invoices" ADD COLUMN "buyer_address" text;

-- ROLLBACK:
-- ALTER TABLE "invoices" DROP COLUMN IF EXISTS "buyer_address";
-- ALTER TABLE "invoices" DROP COLUMN IF EXISTS "buyer_name_ar";
-- ALTER TABLE "invoices" DROP COLUMN IF EXISTS "buyer_name";
-- ALTER TABLE "invoices" DROP COLUMN IF EXISTS "seller_address";
-- ALTER TABLE "invoices" DROP COLUMN IF EXISTS "seller_vat_number";
-- ALTER TABLE "invoices" DROP COLUMN IF EXISTS "seller_cr_number";
-- ALTER TABLE "invoices" DROP COLUMN IF EXISTS "seller_name_ar";
-- ALTER TABLE "invoices" DROP COLUMN IF EXISTS "seller_name";
