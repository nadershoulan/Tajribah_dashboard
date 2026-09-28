-- P5.9: what the cut-out check found for each of a watch's two pictures (the share of its real
-- size the watch is shown at, whether empty edges were cropped away), kept against the picture's
-- key so a replaced picture is never judged by its predecessor. quality_score (0001) holds the
-- watch's score. tryon_configs already has its RLS policy (0001); a new column changes nothing.
ALTER TABLE "tryon_configs" ADD COLUMN "quality" jsonb;

-- ROLLBACK:
-- ALTER TABLE "tryon_configs" DROP COLUMN IF EXISTS "quality";
