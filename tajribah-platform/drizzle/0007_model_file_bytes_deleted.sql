-- P2.2: storage used is the bytes a store actually holds. A refused upload and an expired draft
-- delete their bytes but keep the file row (its size is still shown against the version), so
-- summing file sizes over-counted. The row now says when its bytes were deleted; storage held
-- is the sum over files where this is null. Null for everything uploaded before: nothing was
-- deleted that the row does not already show as failed, and the sweep below never ran on them.
ALTER TABLE "model_files" ADD COLUMN "bytes_deleted_at" timestamp with time zone;

-- ROLLBACK:
-- ALTER TABLE "model_files" DROP COLUMN IF EXISTS "bytes_deleted_at";
