// API-111 — POST /api/notifications/read
import { withBoot } from '@/server/boot';
import { markReadHandler } from '@/server/modules/notifications/http';

export const POST = withBoot(markReadHandler);
