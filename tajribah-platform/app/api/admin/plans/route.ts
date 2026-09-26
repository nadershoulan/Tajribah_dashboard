// API-A09 — GET /api/admin/plans
import { withBoot } from '@/server/boot';
import { plansHandler } from '@/server/modules/admin/http';

export const GET = withBoot(plansHandler);
