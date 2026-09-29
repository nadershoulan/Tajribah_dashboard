// API-H01 — GET /api/health (alive) (P7)
import { withBoot } from '@/server/boot';
import { liveHandler } from '@/server/modules/health/http';

export const GET = withBoot(liveHandler);
