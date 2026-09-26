// API-A23 — POST /api/admin/view/end
import { withBoot } from '@/server/boot';
import { endStaffViewHandler } from '@/server/modules/admin/http';

export const POST = withBoot(endStaffViewHandler);
