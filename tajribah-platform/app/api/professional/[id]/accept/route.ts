// API-139 — POST /api/professional/[id]/accept (T68)
import { withBoot } from '@/server/boot';
import { acceptProfessionalHandler } from '@/server/modules/professional/http';

export const POST = withBoot(acceptProfessionalHandler);
