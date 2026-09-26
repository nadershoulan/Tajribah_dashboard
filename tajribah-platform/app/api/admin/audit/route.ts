// API-A01 — GET /api/admin/audit
import { withBoot } from '@/server/boot';
import { staffTrailHandler } from '@/server/modules/admin/http';

export const GET = withBoot(staffTrailHandler);
