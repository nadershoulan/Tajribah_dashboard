// API-055 — GET /api/models/versions/[id]/file
import { withBoot } from '@/server/boot';
import { modelFileHandler } from '@/server/modules/models/http';

export const GET = withBoot(modelFileHandler);
