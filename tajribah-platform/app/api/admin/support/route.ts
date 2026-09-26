// API-A17 — GET /api/admin/support
import { withBoot } from '@/server/boot';
import { supportLookupHandler } from '@/server/modules/admin/http';

export const GET = withBoot(supportLookupHandler);
