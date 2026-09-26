// API-134 — POST /api/billing/coupons/check
import { withBoot } from '@/server/boot';
import { checkCouponHandler } from '@/server/modules/billing/http';

export const POST = withBoot(checkCouponHandler);
