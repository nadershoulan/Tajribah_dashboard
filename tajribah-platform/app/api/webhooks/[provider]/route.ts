// API-040 — POST /api/webhooks/[provider]
import { withBoot } from '@/server/boot';
import { receiveWebhookHandler } from '@/server/modules/webhooks/http';

export const POST = withBoot(receiveWebhookHandler);
