// API-A15 — POST /api/admin/jobs/[id]/retry
import { withBoot } from '@/server/boot';
import { retryJobHandler } from '@/server/modules/admin/http';

export const POST = withBoot(retryJobHandler);
