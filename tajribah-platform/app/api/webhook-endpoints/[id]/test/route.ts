// API-175 — POST /api/webhook-endpoints/[id]/test (P8, outgoing webhooks)
import { withBoot } from '@/server/boot';
import { sendTestHandler } from '@/server/modules/outgoing-webhooks/http';

export const POST = withBoot(sendTestHandler);
