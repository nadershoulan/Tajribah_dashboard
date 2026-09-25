// API-060 — GET /api/connections
import { withBoot } from '@/server/boot';
import { listConnectionsHandler } from '@/server/modules/connections/http';

export const GET = withBoot(listConnectionsHandler);
