// API-078 — PATCH /api/team/roles/[id] · API-079 — DELETE (P8, custom roles)
import { withBoot } from '@/server/boot';
import { deleteCustomRoleHandler, updateCustomRoleHandler } from '@/server/modules/team/http';

export const PATCH = withBoot(updateCustomRoleHandler);
export const DELETE = withBoot(deleteCustomRoleHandler);
