// API-122 — POST /v1/e: the collector at the address the widget ships with (`ev.tajribah.org/v1/e`, P4.2)
import { withBoot } from '@/server/boot';
import { collectHandler } from '@/server/modules/analytics/http';

export const POST = withBoot(collectHandler);
