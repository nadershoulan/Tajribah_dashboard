// API-142 — POST /api/ai-jobs/[id]/cancel
import { withBoot } from '@/server/boot';
import { cancelAiJobHandler } from '@/server/modules/ai-jobs/http';

export const POST = withBoot(cancelAiJobHandler);
