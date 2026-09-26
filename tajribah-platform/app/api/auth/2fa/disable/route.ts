// API-015 — POST /api/auth/2fa/disable
import { withBoot } from '@/server/boot';
import { twoFactorDisableHandler } from '@/server/modules/auth/http';

export const POST = withBoot(twoFactorDisableHandler);
