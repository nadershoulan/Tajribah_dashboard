// API-A10 — PATCH /api/admin/plans/[code]
import { withBoot } from '@/server/boot';
import { updatePlanHandler } from '@/server/modules/admin/http';

export const PATCH = withBoot(updatePlanHandler);
