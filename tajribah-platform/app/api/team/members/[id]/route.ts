// API-073 — PATCH · API-074 — DELETE /api/team/members/[id]
import { withBoot } from '@/server/boot';
import { changeRoleHandler, removeMemberHandler } from '@/server/modules/team/http';

export const PATCH = withBoot(changeRoleHandler);
export const DELETE = withBoot(removeMemberHandler);
