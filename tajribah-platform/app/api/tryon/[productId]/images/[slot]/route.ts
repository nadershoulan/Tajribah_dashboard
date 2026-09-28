// API-154 — GET /api/tryon/[productId]/images/[slot]
import { withBoot } from '@/server/boot';
import { cutoutFileHandler } from '@/server/modules/tryon/http';

export const GET = withBoot(cutoutFileHandler);
