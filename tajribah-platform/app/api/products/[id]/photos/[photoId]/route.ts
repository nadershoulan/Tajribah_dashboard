// API-146 — DELETE /api/products/[id]/photos/[photoId]
import { withBoot } from '@/server/boot';
import { removePhotoHandler } from '@/server/modules/ai-jobs/http';

export const DELETE = withBoot(removePhotoHandler);
