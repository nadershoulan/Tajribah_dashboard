// API-A49 — POST /api/admin/professional/[id]/delivery/confirm (T68)
import { withBoot } from '@/server/boot';
import { professionalDeliveredHandler } from '@/server/modules/admin/http';

export const POST = withBoot(professionalDeliveredHandler);
