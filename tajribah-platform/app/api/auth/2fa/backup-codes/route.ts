// API-016 — POST /api/auth/2fa/backup-codes
import { withBoot } from '@/server/boot';
import { twoFactorBackupCodesHandler } from '@/server/modules/auth/http';

export const POST = withBoot(twoFactorBackupCodesHandler);
