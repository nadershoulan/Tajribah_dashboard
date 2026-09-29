// API-V03 — GET /api/v1/models (P8, Public API)
import { withBoot } from '@/server/boot';
import { v1ModelsHandler } from '@/server/modules/public-api/http';

export const GET = withBoot(v1ModelsHandler);
