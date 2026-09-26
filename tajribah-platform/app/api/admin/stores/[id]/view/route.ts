// API-A22 — POST /api/admin/stores/[id]/view
import { withBoot } from '@/server/boot';
import { startStaffViewHandler } from '@/server/modules/admin/http';

export const POST = withBoot(startStaffViewHandler);
