// API-A14 — GET /api/admin/operations
import { withBoot } from '@/server/boot';
import { operationsHandler } from '@/server/modules/admin/http';

export const GET = withBoot(operationsHandler);
