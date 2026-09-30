// API-018 — POST /api/auth/sso/start (P8)
import { withBoot } from '@/server/boot';
import { startSsoHandler } from '@/server/modules/sso/http';

export const POST = withBoot(startSsoHandler);
