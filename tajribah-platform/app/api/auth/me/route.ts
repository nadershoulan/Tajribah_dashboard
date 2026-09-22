// API-005 — GET /api/auth/me
import { withBoot } from '@/server/boot';
import { meHandler } from '@/server/modules/auth/http';

export const GET = withBoot(meHandler);
