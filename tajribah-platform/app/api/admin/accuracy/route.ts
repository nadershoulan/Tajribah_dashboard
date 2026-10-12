// T140.5 — GET /api/admin/accuracy
import { withBoot } from '@/server/boot';
import { accuracyHandler } from '@/server/modules/admin/http';

export const GET = withBoot(accuracyHandler);
