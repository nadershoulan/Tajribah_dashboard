// API-101 — PUT /api/ar-configs/[productId]
import { withBoot } from '@/server/boot';
import { saveArConfigHandler } from '@/server/modules/ar/http';

export const PUT = withBoot(saveArConfigHandler);
