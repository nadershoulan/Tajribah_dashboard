// API-082/083 — GET, PUT /api/settings/sso (P8)
import { withBoot } from '@/server/boot';
import { saveSsoSettingsHandler, ssoSettingsHandler } from '@/server/modules/sso/http';

export const GET = withBoot(ssoSettingsHandler);
export const PUT = withBoot(saveSsoSettingsHandler);
