// API-076 — GET /api/team/roles · API-077 — POST (P8, custom roles)
import { withBoot } from '@/server/boot';
import { createCustomRoleHandler, listCustomRolesHandler } from '@/server/modules/team/http';

export const GET = withBoot(listCustomRolesHandler);
export const POST = withBoot(createCustomRoleHandler);
