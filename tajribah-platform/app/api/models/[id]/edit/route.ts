// API-056 — POST /api/models/[id]/edit
import { withBoot } from '@/server/boot';
import { editModelHandler } from '@/server/modules/models/http';

export const POST = withBoot(editModelHandler);
