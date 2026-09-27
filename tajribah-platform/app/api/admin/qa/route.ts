// API-A34 — GET /api/admin/qa
import { withBoot } from '@/server/boot';
import { qaQueueHandler } from '@/server/modules/admin/http';

export const GET = withBoot(qaQueueHandler);
