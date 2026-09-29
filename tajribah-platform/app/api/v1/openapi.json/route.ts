// API-V00 — GET /api/v1/openapi.json (the reference, public) (P8, Public API)
import { withBoot } from '@/server/boot';
import { v1OpenApiHandler } from '@/server/modules/public-api/http';

export const GET = withBoot(v1OpenApiHandler);
