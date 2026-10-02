// API-127 — POST /api/models/[id]/picture · API-129 — GET (P3.8)
import { withBoot } from '@/server/boot';
import { pictureHandler, startPictureHandler } from '@/server/modules/models/http';

export const POST = withBoot(startPictureHandler);
export const GET = withBoot(pictureHandler);
