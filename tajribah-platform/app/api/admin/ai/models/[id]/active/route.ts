// API-A43 — POST /api/admin/ai/models/[id]/active (P6)
import { withBoot } from '@/server/boot';
import { setModelActiveHandler } from '@/server/modules/admin/http';

export const POST = withBoot(setModelActiveHandler);
