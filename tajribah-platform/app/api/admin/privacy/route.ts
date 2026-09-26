// API-A24 — GET /api/admin/privacy · API-A25 — POST /api/admin/privacy
import { withBoot } from '@/server/boot';
import { listPrivacyHandler, recordPrivacyHandler } from '@/server/modules/admin/http';

export const GET = withBoot(listPrivacyHandler);
export const POST = withBoot(recordPrivacyHandler);
