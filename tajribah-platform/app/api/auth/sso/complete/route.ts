// API-019 — POST /api/auth/sso/complete (P8)
import { withBoot } from '@/server/boot';
import { completeSsoHandler } from '@/server/modules/sso/http';

export const POST = withBoot(completeSsoHandler);
