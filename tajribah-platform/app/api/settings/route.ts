// API-080 — GET · API-081 — PATCH /api/settings
import { withBoot } from '@/server/boot';
import { getSettingsHandler, updateSettingsHandler } from '@/server/modules/settings/http';

export const GET = withBoot(getSettingsHandler);
export const PATCH = withBoot(updateSettingsHandler);
