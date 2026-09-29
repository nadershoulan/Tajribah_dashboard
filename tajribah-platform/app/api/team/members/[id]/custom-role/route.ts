// API-080 — PUT /api/team/members/[id]/custom-role (P8, custom roles)
import { withBoot } from '@/server/boot';
import { assignCustomRoleHandler } from '@/server/modules/team/http';

export const PUT = withBoot(assignCustomRoleHandler);
