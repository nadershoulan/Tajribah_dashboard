// API-186 — GET /api/products/categories (T77)
import { withBoot } from '@/server/boot';
import { listProductCategoriesHandler } from '@/server/modules/products/http';

export const GET = withBoot(listProductCategoriesHandler);
