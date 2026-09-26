// API-013 — POST /api/auth/2fa/setup
import { withBoot } from '@/server/boot';
import { twoFactorSetupHandler } from '@/server/modules/auth/http';

export const POST = withBoot(twoFactorSetupHandler);
