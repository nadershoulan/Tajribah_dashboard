// API-065 — GET /api/connections/providers (P6)
import { withBoot } from '@/server/boot';
import { connectionProvidersHandler } from '@/server/modules/connections/http';

export const GET = withBoot(connectionProvidersHandler);
