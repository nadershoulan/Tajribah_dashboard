// API-A35 — POST /api/admin/qa/[modelId]
import { withBoot } from '@/server/boot';
import { decideQaHandler } from '@/server/modules/admin/http';

export const POST = withBoot(decideQaHandler);
