// API-181 — GET /api/google/callback
import { withBoot } from '@/server/boot';
import { googleCallbackHandler } from '@/server/modules/google/http';

export const GET = withBoot(googleCallbackHandler);
