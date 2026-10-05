// API-189 — GET /api/tryon/[productId]/preview (T85)
import { withBoot } from '@/server/boot';
import { tryOnPreviewHandler } from '@/server/modules/tryon/http';

export const GET = withBoot(tryOnPreviewHandler);
