// API-183 — GET /api/qr
import { withBoot } from '@/server/boot';
import { qrCodesHandler } from '@/server/modules/ar/http';

export const GET = withBoot(qrCodesHandler);
