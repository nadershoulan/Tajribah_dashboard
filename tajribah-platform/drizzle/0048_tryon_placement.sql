-- T134.6 (Nader, 2026-10-11): the store sets where its product sits on each model photo in «جرّبه كما يراه المتسوّق» —
-- the zone the product's centre stays in and where it starts (its size a share of its real size), per model photo:
-- {"wrist": {"zone": {"x","y","w","h"}, "pose": {"x","y","angle","scale"}}, ...} on the studio's 1200 × 1050 stage.
-- Checked by lib/tryon-placement.ts on save and on read. Null: the built-in places, as before. Nullable, no default:
-- the running version neither reads nor writes it.
ALTER TABLE "tryon_configs" ADD COLUMN "placement" jsonb;

-- ROLLBACK:
-- ALTER TABLE "tryon_configs" DROP COLUMN "placement";
