// API-110 — GET /api/notifications
import { withBoot } from '@/server/boot';
import { listNotificationsHandler } from '@/server/modules/notifications/http';

export const GET = withBoot(listNotificationsHandler);
