// API-193 — POST /api/qr/store-pages (T99)
import { withBoot } from '@/server/boot';
import { applyStorePagesHandler } from '@/server/modules/ar/http';

export const POST = withBoot(applyStorePagesHandler);
