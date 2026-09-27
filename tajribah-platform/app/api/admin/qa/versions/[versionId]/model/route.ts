// API-A36 — GET /api/admin/qa/versions/[versionId]/model
import { withBoot } from '@/server/boot';
import { qaModelFileHandler } from '@/server/modules/admin/http';

export const GET = withBoot(qaModelFileHandler);
