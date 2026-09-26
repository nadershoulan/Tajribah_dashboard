// API-010 — POST /api/auth/verify-email/resend
import { withBoot } from '@/server/boot';
import { resendVerificationHandler } from '@/server/modules/auth/http';

export const POST = withBoot(resendVerificationHandler);
