// API-170 — GET /api/webhook-endpoints · API-171 — POST (P8, outgoing webhooks)
import { withBoot } from '@/server/boot';
import { createEndpointHandler, listEndpointsHandler } from '@/server/modules/outgoing-webhooks/http';

export const GET = withBoot(listEndpointsHandler);
export const POST = withBoot(createEndpointHandler);
