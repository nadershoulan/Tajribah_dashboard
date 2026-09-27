// API-A38 — POST /api/admin/ai/jobs/[id]/cancel
import { withBoot } from '@/server/boot';
import { cancelAiJobForStoreHandler } from '@/server/modules/admin/http';

export const POST = withBoot(cancelAiJobForStoreHandler);
