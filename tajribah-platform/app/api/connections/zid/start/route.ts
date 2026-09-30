// API-084 — POST /api/connections/zid/start (T61)
import { withBoot } from '@/server/boot';
import { startZidHandler } from '@/server/modules/connections/http';

export const POST = withBoot(startZidHandler);
