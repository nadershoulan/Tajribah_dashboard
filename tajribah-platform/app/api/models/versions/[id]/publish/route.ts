// API-054 — POST /api/models/versions/[id]/publish
import { withBoot } from '@/server/boot';
import { publishVersionHandler } from '@/server/modules/models/http';

export const POST = withBoot(publishVersionHandler);
