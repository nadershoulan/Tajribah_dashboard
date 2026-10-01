// API-122 — POST /api/analytics/collect (P4.2: a shop's events, from the widget)
import { withBoot } from '@/server/boot';
import { collectHandler } from '@/server/modules/analytics/http';

export const POST = withBoot(collectHandler);
