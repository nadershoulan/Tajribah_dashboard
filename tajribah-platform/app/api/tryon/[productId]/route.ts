// API-153 — PATCH /api/tryon/[productId]
import { withBoot } from '@/server/boot';
import { updateTryOnHandler } from '@/server/modules/tryon/http';

export const PATCH = withBoot(updateTryOnHandler);
