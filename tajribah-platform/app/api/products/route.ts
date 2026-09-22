// API-030 — GET /api/products · API-031 — POST /api/products
import { withBoot } from '@/server/boot';
import { createProductHandler, listProductsHandler } from '@/server/modules/products/http';

export const GET = withBoot(listProductsHandler);
export const POST = withBoot(createProductHandler);
