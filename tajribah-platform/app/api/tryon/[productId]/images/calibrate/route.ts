// API-178 — POST /api/tryon/[productId]/images/calibrate (T68)
import { withBoot } from '@/server/boot';
import { calibrateCutoutHandler } from '@/server/modules/tryon/http';

export const POST = withBoot(calibrateCutoutHandler);
