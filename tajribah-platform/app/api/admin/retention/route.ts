// API-A30 — GET /api/admin/retention
import { withBoot } from '@/server/boot';
import { retentionHandler } from '@/server/modules/admin/http';

export const GET = withBoot(retentionHandler);
