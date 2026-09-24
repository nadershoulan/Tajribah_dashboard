// API-050 — POST /api/models/uploads
import { withBoot } from '@/server/boot';
import { startUploadHandler } from '@/server/modules/models/http';

export const POST = withBoot(startUploadHandler);
