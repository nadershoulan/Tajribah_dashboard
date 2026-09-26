// API-A31 — GET /api/admin/announcements · API-A32 — POST
import { withBoot } from '@/server/boot';
import { createAnnouncementHandler, listAnnouncementsHandler } from '@/server/modules/admin/http';

export const GET = withBoot(listAnnouncementsHandler);
export const POST = withBoot(createAnnouncementHandler);
