// API-058 — DELETE /api/models/[id] (T46)
import { withBoot } from '@/server/boot';
import { deleteModelHandler } from '@/server/modules/models/http';

export const DELETE = withBoot(deleteModelHandler);
