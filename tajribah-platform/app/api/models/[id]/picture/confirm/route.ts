// API-128 — POST /api/models/[id]/picture/confirm (P3.8)
import { withBoot } from '@/server/boot';
import { confirmPictureHandler } from '@/server/modules/models/http';

export const POST = withBoot(confirmPictureHandler);
