// API-192 — POST /api/tryon/[productId]/publish (T90)
import { withBoot } from '@/server/boot';
import { publishTryOnHandler } from '@/server/modules/tryon/http';

export const POST = withBoot(publishTryOnHandler);
