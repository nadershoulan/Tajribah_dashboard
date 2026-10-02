// API-A46 — POST /api/admin/professional/[id]/quote (P3.10)
import { withBoot } from '@/server/boot';
import { quoteProfessionalHandler } from '@/server/modules/admin/http';

export const POST = withBoot(quoteProfessionalHandler);
