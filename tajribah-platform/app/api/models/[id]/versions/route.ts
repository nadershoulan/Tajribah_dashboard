// API-053 — GET /api/models/[id]/versions
import { withBoot } from '@/server/boot';
import { modelVersionsHandler } from '@/server/modules/models/http';

export const GET = withBoot(modelVersionsHandler);
