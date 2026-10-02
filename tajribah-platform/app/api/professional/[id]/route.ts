// API-137 — DELETE /api/professional/[id] (P3.10)
import { withBoot } from '@/server/boot';
import { cancelProfessionalHandler } from '@/server/modules/professional/http';

export const DELETE = withBoot(cancelProfessionalHandler);
