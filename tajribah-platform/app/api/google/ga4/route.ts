// API-179 — GET /api/google/ga4
import { withBoot } from '@/server/boot';
import { googleAvailableHandler } from '@/server/modules/google/http';

export const GET = withBoot(googleAvailableHandler);
