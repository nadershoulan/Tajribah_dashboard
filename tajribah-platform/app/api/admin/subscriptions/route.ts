// API-A11 — GET /api/admin/subscriptions
import { withBoot } from '@/server/boot';
import { listSubscriptionsHandler } from '@/server/modules/admin/http';

export const GET = withBoot(listSubscriptionsHandler);
