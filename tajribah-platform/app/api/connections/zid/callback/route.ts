// API-086 — GET /api/connections/zid/callback (T61: Zid's OAuth callback)
import { withBoot } from '@/server/boot';
import { zidCallbackHandler } from '@/server/modules/connections/http';

export const GET = withBoot(zidCallbackHandler);
