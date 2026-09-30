// API-085 — GET /api/connections/zid/activate (T61: Zid's "Activate" opens this)
import { withBoot } from '@/server/boot';
import { activateZidHandler } from '@/server/modules/connections/http';

export const GET = withBoot(activateZidHandler);
