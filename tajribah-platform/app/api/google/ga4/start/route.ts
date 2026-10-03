// API-180 — POST /api/google/ga4/start
import { withBoot } from '@/server/boot';
import { startGoogleHandler } from '@/server/modules/google/http';

export const POST = withBoot(startGoogleHandler);
