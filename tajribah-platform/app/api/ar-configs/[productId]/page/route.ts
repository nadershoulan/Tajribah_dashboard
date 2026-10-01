// API-126 — PUT /api/ar-configs/[productId]/page (P1.19)
import { withBoot } from '@/server/boot';
import { saveHostedPageHandler } from '@/server/modules/ar/http';

export const PUT = withBoot(saveHostedPageHandler);
