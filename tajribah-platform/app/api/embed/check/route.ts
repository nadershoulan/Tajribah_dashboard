// API-121 — POST /api/embed/check
import { withBoot } from '@/server/boot';
import { checkInstallHandler } from '@/server/modules/embed/http';

export const POST = withBoot(checkInstallHandler);
