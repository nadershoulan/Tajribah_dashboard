// API-120 — GET /api/embed
import { withBoot } from '@/server/boot';
import { snippetHandler } from '@/server/modules/embed/http';

export const GET = withBoot(snippetHandler);
