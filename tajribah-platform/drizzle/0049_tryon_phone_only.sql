-- T135 (Nader, 2026-10-11): a product's try-on "on the phone only" — the shop's button opens the phone camera try-on
-- directly on a phone, and shows a QR code to continue on the phone on a computer (no model photos), as Tangiblee's.
-- Default false: every product as before. The running version neither reads nor writes it.
ALTER TABLE "tryon_configs" ADD COLUMN "phone_only" boolean DEFAULT false NOT NULL;

-- ROLLBACK:
-- ALTER TABLE "tryon_configs" DROP COLUMN "phone_only";
