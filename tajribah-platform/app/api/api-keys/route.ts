// API-160 — GET /api/api-keys · API-161 — POST (P8)
import { withBoot } from '@/server/boot';
import { createApiKeyHandler, listApiKeysHandler } from '@/server/modules/api-keys/http';

export const GET = withBoot(listApiKeysHandler);
export const POST = withBoot(createApiKeyHandler);
