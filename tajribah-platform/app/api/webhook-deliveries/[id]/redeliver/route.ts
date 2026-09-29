// API-177 — POST /api/webhook-deliveries/[id]/redeliver (P8, outgoing webhooks)
import { withBoot } from '@/server/boot';
import { redeliverHandler } from '@/server/modules/outgoing-webhooks/http';

export const POST = withBoot(redeliverHandler);
