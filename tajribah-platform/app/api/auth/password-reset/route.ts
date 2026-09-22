// API-008 — POST /api/auth/password-reset
import { withBoot } from '@/server/boot';
import { requestResetHandler } from '@/server/modules/auth/http';

export const POST = withBoot(requestResetHandler);
