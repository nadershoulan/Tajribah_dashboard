// API-A71 — PATCH /api/admin/contact/{id} · API-A72 — DELETE (T115)
import { withBoot } from '@/server/boot';
import { contactDeleteHandler, contactStatusHandler } from '@/server/modules/admin/http';

export const PATCH = withBoot(contactStatusHandler);
export const DELETE = withBoot(contactDeleteHandler);
