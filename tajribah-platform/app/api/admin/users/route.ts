// API-A06 — GET /api/admin/users
import { withBoot } from '@/server/boot';
import { listPeopleHandler } from '@/server/modules/admin/http';

export const GET = withBoot(listPeopleHandler);
