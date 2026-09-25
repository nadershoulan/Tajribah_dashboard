// API-100 — GET /api/ar-configs
import { withBoot } from '@/server/boot';
import { listArConfigsHandler } from '@/server/modules/ar/http';

export const GET = withBoot(listArConfigsHandler);
