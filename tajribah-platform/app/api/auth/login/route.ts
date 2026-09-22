// API-002 — POST /api/auth/login
import { withBoot } from '@/server/boot';
import { loginHandler } from '@/server/modules/auth/http';

export const POST = withBoot(loginHandler);
