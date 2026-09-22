// API-004 — POST /api/auth/logout
import { withBoot } from '@/server/boot';
import { logoutHandler } from '@/server/modules/auth/http';

export const POST = withBoot(logoutHandler);
