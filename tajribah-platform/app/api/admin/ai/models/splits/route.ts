// API-A42 — PUT /api/admin/ai/models/splits (P6)
import { withBoot } from '@/server/boot';
import { setSplitsHandler } from '@/server/modules/admin/http';

export const PUT = withBoot(setSplitsHandler);
