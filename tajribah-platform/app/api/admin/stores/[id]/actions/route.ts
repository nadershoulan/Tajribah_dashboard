// API-A05 — POST /api/admin/stores/[id]/actions
import { withBoot } from '@/server/boot';
import { storeActionHandler } from '@/server/modules/admin/http';

export const POST = withBoot(storeActionHandler);
