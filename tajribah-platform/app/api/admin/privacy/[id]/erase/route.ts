// API-A28 — POST /api/admin/privacy/[id]/erase
import { withBoot } from '@/server/boot';
import { fulfilErasureHandler } from '@/server/modules/admin/http';

export const POST = withBoot(fulfilErasureHandler);
