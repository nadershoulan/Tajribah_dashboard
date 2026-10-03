// API-A47 — POST /api/admin/professional/[id]/paid (T68)
import { withBoot } from '@/server/boot';
import { professionalPaidHandler } from '@/server/modules/admin/http';

export const POST = withBoot(professionalPaidHandler);
