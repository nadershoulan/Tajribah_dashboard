// API-070 — GET /api/team
import { withBoot } from '@/server/boot';
import { listTeamHandler } from '@/server/modules/team/http';

export const GET = withBoot(listTeamHandler);
