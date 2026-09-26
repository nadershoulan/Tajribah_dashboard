// API-012 — GET /api/auth/2fa
import { withBoot } from '@/server/boot';
import { twoFactorStatusHandler } from '@/server/modules/auth/http';

export const GET = withBoot(twoFactorStatusHandler);
