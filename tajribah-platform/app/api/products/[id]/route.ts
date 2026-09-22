// API-032 — GET · API-033 — PATCH · API-034 — DELETE /api/products/[id]
import { withBoot } from '@/server/boot';
import { deleteProductHandler, getProductHandler, updateProductHandler } from '@/server/modules/products/http';

export const GET = withBoot(getProductHandler);
export const PATCH = withBoot(updateProductHandler);
export const DELETE = withBoot(deleteProductHandler);
