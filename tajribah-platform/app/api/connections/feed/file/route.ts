// API-185 — POST /api/connections/feed/file (a product sheet, imported now)
import { withBoot } from '@/server/boot';
import { importProductFileHandler } from '@/server/modules/connections/http';

export const POST = withBoot(importProductFileHandler);
