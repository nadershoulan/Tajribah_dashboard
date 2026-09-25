// API-052 — GET /api/models
import { withBoot } from '@/server/boot';
import { listModelsHandler } from '@/server/modules/models/http';

export const GET = withBoot(listModelsHandler);
