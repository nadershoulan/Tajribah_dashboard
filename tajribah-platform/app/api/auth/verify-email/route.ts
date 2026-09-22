// API-007 — POST /api/auth/verify-email
import { withBoot } from '@/server/boot';
import { verifyEmailHandler } from '@/server/modules/auth/http';

export const POST = withBoot(verifyEmailHandler);
