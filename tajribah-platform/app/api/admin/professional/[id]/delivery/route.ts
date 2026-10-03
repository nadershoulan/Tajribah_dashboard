// API-A48 — POST /api/admin/professional/[id]/delivery (T68)
import { withBoot } from '@/server/boot';
import { professionalDeliveryHandler } from '@/server/modules/admin/http';

export const POST = withBoot(professionalDeliveryHandler);
