// API-191 — GET /api/tryon/[productId]/store-picture (T88)
import { withBoot } from '@/server/boot';
import { storePhotoHandler } from '@/server/modules/tryon/http';

export const GET = withBoot(storePhotoHandler);
