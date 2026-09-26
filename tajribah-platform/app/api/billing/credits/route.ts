// API-132 — GET /api/billing/credits
import { withBoot } from '@/server/boot';
import { creditsHandler } from '@/server/modules/billing/http';

export const GET = withBoot(creditsHandler);
