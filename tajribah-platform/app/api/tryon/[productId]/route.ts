// API-153 — PATCH /api/tryon/[productId]; API-190 — GET (T87)
import { withBoot } from '@/server/boot';
import { tryOnOneHandler, updateTryOnHandler } from '@/server/modules/tryon/http';

export const GET = withBoot(tryOnOneHandler);
export const PATCH = withBoot(updateTryOnHandler);
