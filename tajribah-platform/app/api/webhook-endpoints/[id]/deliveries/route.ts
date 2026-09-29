// API-176 — GET /api/webhook-endpoints/[id]/deliveries (P8, outgoing webhooks)
import { withBoot } from '@/server/boot';
import { listDeliveriesHandler } from '@/server/modules/outgoing-webhooks/http';

export const GET = withBoot(listDeliveriesHandler);
