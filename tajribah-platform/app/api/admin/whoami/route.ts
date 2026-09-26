// API-A00 — GET /api/admin/whoami
import { withBoot } from '@/server/boot';
import { whoamiHandler } from '@/server/modules/admin/http';

export const GET = withBoot(whoamiHandler);
