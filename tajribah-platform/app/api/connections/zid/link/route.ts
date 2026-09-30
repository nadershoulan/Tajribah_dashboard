// API-087 — POST /api/connections/zid/link (T61)
import { withBoot } from '@/server/boot';
import { linkZidHandler } from '@/server/modules/connections/http';

export const POST = withBoot(linkZidHandler);
