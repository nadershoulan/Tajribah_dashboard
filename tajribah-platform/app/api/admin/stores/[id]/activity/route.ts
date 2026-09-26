// API-A18 — GET /api/admin/stores/[id]/activity
import { withBoot } from '@/server/boot';
import { storeActivityHandler } from '@/server/modules/admin/http';

export const GET = withBoot(storeActivityHandler);
