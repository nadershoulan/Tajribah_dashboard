// API-138 — GET /api/products/[id]/related (recommendations, first version)
import { withBoot } from '@/server/boot';
import { relatedHandler } from '@/server/modules/recommendations/http';

export const GET = withBoot(relatedHandler);
