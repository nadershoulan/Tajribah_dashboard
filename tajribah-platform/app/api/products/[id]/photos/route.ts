// API-145 — GET /api/products/[id]/photos · API-143 — POST (start an upload)
import { withBoot } from '@/server/boot';
import { listPhotosHandler, startPhotoHandler } from '@/server/modules/ai-jobs/http';

export const GET = withBoot(listPhotosHandler);
export const POST = withBoot(startPhotoHandler);
