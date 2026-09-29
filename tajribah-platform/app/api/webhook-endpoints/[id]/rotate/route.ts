// API-174 — POST /api/webhook-endpoints/[id]/rotate (P8, outgoing webhooks)
import { withBoot } from '@/server/boot';
import { rotateSecretHandler } from '@/server/modules/outgoing-webhooks/http';

export const POST = withBoot(rotateSecretHandler);
