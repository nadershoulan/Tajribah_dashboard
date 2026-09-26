// API-A33 — PATCH /api/admin/announcements/[id]
import { withBoot } from '@/server/boot';
import { updateAnnouncementHandler } from '@/server/modules/admin/http';

export const PATCH = withBoot(updateAnnouncementHandler);
