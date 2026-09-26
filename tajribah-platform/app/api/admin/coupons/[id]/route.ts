// API-A21 — PATCH /api/admin/coupons/[id]
import { withBoot } from '@/server/boot';
import { updateCouponHandler } from '@/server/modules/admin/http';

export const PATCH = withBoot(updateCouponHandler);
