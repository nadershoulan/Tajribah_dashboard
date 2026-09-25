// API-061 — POST /api/connections/[id]/sync
import { withBoot } from '@/server/boot';
import { requestSyncHandler } from '@/server/modules/connections/http';

export const POST = withBoot(requestSyncHandler);
