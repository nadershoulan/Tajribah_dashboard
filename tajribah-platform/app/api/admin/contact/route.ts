// API-A70 — GET /api/admin/contact: the contact inbox (T115)
import { withBoot } from '@/server/boot';
import { contactInboxHandler } from '@/server/modules/admin/http';

export const GET = withBoot(contactInboxHandler);
