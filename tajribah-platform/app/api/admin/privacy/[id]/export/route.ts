// API-A26 — POST /api/admin/privacy/[id]/export · API-A27 — GET (the kept file)
import { withBoot } from '@/server/boot';
import { downloadExportHandler, fulfilExportHandler } from '@/server/modules/admin/http';

export const GET = withBoot(downloadExportHandler);
export const POST = withBoot(fulfilExportHandler);
