// API-A07 — GET /api/admin/users/[id]
import { withBoot } from '@/server/boot';
import { personDetailHandler } from '@/server/modules/admin/http';

export const GET = withBoot(personDetailHandler);
