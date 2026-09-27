// API-140 — GET /api/ai-jobs
import { withBoot } from '@/server/boot';
import { listAiJobsHandler } from '@/server/modules/ai-jobs/http';

export const GET = withBoot(listAiJobsHandler);
