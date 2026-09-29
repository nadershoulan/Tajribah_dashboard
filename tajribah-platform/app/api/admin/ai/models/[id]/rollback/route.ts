// API-A44 — POST /api/admin/ai/models/[id]/rollback (P6)
import { withBoot } from '@/server/boot';
import { rollbackModelHandler } from '@/server/modules/admin/http';

export const POST = withBoot(rollbackModelHandler);
