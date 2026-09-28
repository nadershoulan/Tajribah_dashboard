// API-151 — POST /api/tryon/[productId]/images
import { withBoot } from '@/server/boot';
import { startCutoutHandler } from '@/server/modules/tryon/http';

export const POST = withBoot(startCutoutHandler);
