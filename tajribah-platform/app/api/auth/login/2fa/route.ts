// API-011 — POST /api/auth/login/2fa
import { withBoot } from '@/server/boot';
import { loginTwoFactorHandler } from '@/server/modules/auth/http';

export const POST = withBoot(loginTwoFactorHandler);
