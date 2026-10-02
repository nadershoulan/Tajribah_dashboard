// API-135 — GET /api/professional · API-136 — POST (P3.10)
import { withBoot } from '@/server/boot';
import { listProfessionalHandler, requestProfessionalHandler } from '@/server/modules/professional/http';

export const GET = withBoot(listProfessionalHandler);
export const POST = withBoot(requestProfessionalHandler);
