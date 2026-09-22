// API-009 — POST /api/auth/password-reset/confirm
import { withBoot } from '@/server/boot';
import { confirmResetHandler } from '@/server/modules/auth/http';

export const POST = withBoot(confirmResetHandler);
