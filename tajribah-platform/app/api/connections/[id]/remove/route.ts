// API-187 — POST /api/connections/[id]/remove (T78)
import { withBoot } from '@/server/boot';
import { removeStoreHandler } from '@/server/modules/connections/http';

export const POST = withBoot(removeStoreHandler);
