// API-003 — POST /api/auth/refresh
import { withBoot } from '@/server/boot';
import { refreshHandler } from '@/server/modules/auth/http';

export const POST = withBoot(refreshHandler);
