// API-A29 — POST /api/admin/privacy/[id]/reject
import { withBoot } from '@/server/boot';
import { rejectPrivacyHandler } from '@/server/modules/admin/http';

export const POST = withBoot(rejectPrivacyHandler);
