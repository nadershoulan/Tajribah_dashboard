// API-A02 — GET /api/admin/overview
import { withBoot } from '@/server/boot';
import { overviewHandler } from '@/server/modules/admin/http';

export const GET = withBoot(overviewHandler);
