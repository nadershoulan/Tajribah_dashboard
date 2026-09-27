// API-141 — GET /api/ai-jobs/[id]
import { withBoot } from '@/server/boot';
import { aiJobHandler } from '@/server/modules/ai-jobs/http';

export const GET = withBoot(aiJobHandler);
