// API-162 — POST /api/api-keys/[id]/revoke (P8)
import { withBoot } from '@/server/boot';
import { revokeApiKeyHandler } from '@/server/modules/api-keys/http';

export const POST = withBoot(revokeApiKeyHandler);
