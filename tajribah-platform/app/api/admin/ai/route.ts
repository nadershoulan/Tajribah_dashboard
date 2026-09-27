// API-A37 — GET /api/admin/ai
import { withBoot } from '@/server/boot';
import { aiOperationsHandler } from '@/server/modules/admin/http';

export const GET = withBoot(aiOperationsHandler);
