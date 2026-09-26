// API-014 — POST /api/auth/2fa/enable
import { withBoot } from '@/server/boot';
import { twoFactorEnableHandler } from '@/server/modules/auth/http';

export const POST = withBoot(twoFactorEnableHandler);
