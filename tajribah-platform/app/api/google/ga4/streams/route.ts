// API-182 — POST /api/google/ga4/streams
import { withBoot } from '@/server/boot';
import { googleStreamsHandler } from '@/server/modules/google/http';

export const POST = withBoot(googleStreamsHandler);
