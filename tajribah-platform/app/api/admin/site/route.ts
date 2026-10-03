// API-A50 — GET /api/admin/site · API-A51 — PUT
import { withBoot } from '@/server/boot';
import { siteSettingsHandler, updateSiteSettingsHandler } from '@/server/modules/admin/http';

export const GET = withBoot(siteSettingsHandler);
export const PUT = withBoot(updateSiteSettingsHandler);
