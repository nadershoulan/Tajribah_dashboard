// API-150 — GET /api/tryon
import { withBoot } from '@/server/boot';
import { tryOnScreenHandler } from '@/server/modules/tryon/http';

export const GET = withBoot(tryOnScreenHandler);
