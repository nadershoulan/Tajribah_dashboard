// API-152 — POST /api/tryon/[productId]/images/confirm
import { withBoot } from '@/server/boot';
import { confirmCutoutHandler } from '@/server/modules/tryon/http';

export const POST = withBoot(confirmCutoutHandler);
