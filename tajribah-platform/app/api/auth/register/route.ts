// API-001 — POST /api/auth/register
import { withBoot } from '@/server/boot';
import { registerHandler } from '@/server/modules/auth/http';

export const POST = withBoot(registerHandler);
