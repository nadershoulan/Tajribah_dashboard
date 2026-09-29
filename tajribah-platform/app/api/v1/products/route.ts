// API-V01 — GET /api/v1/products (P8, Public API)
import { withBoot } from '@/server/boot';
import { v1ListProductsHandler } from '@/server/modules/public-api/http';

export const GET = withBoot(v1ListProductsHandler);
