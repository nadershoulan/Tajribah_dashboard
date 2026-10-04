// API-184 — POST /api/connections/feed (a product feed's link)
import { withBoot } from '@/server/boot';
import { connectFeedHandler } from '@/server/modules/connections/http';

export const POST = withBoot(connectFeedHandler);
