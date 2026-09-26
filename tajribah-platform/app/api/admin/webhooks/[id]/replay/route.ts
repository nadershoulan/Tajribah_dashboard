// API-A16 — POST /api/admin/webhooks/[id]/replay
import { withBoot } from '@/server/boot';
import { replayDeliveryHandler } from '@/server/modules/admin/http';

export const POST = withBoot(replayDeliveryHandler);
