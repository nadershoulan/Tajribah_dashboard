// API-A45 — GET /api/admin/professional (P3.10)
import { withBoot } from '@/server/boot';
import { professionalQueueHandler } from '@/server/modules/admin/http';

export const GET = withBoot(professionalQueueHandler);
