// API-112 — GET /api/announcements
import { withBoot } from '@/server/boot';
import { announcementsHandler } from '@/server/modules/notifications/http';

export const GET = withBoot(announcementsHandler);
