// API-051 — POST /api/models/versions/[id]/confirm
import { withBoot } from '@/server/boot';
import { confirmUploadHandler } from '@/server/modules/models/http';

export const POST = withBoot(confirmUploadHandler);
