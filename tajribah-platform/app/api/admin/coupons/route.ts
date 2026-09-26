// API-A19 — GET /api/admin/coupons · API-A20 — POST /api/admin/coupons
import { withBoot } from '@/server/boot';
import { createCouponHandler, listCouponsHandler } from '@/server/modules/admin/http';

export const GET = withBoot(listCouponsHandler);
export const POST = withBoot(createCouponHandler);
