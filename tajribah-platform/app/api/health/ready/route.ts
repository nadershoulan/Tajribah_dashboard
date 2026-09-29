// API-H02 — GET /api/health/ready (able to work) (P7)
import { withBoot } from '@/server/boot';
import { readyHandler } from '@/server/modules/health/http';

export const GET = withBoot(readyHandler);
