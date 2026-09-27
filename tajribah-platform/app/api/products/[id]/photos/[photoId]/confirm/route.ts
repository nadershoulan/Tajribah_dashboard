// API-144 — POST /api/products/[id]/photos/[photoId]/confirm
import { withBoot } from '@/server/boot';
import { confirmPhotoHandler } from '@/server/modules/ai-jobs/http';

export const POST = withBoot(confirmPhotoHandler);
