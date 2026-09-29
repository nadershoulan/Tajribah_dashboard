// API-V02 — GET /api/v1/products/[id] (P8, Public API)
import { withBoot } from '@/server/boot';
import { v1ProductHandler } from '@/server/modules/public-api/http';

export const GET = withBoot(v1ProductHandler);
