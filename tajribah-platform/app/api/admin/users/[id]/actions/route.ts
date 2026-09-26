// API-A08 — POST /api/admin/users/[id]/actions
import { withBoot } from '@/server/boot';
import { personActionHandler } from '@/server/modules/admin/http';

export const POST = withBoot(personActionHandler);
