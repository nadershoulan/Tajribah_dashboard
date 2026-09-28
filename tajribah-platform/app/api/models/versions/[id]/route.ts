// API-057 — DELETE /api/models/versions/[id] (T46)
import { withBoot } from '@/server/boot';
import { deleteVersionHandler } from '@/server/modules/models/http';

export const DELETE = withBoot(deleteVersionHandler);
