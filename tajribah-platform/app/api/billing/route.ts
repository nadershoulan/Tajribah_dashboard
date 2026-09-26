// API-133 — GET /api/billing
import { withBoot } from '@/server/boot';
import { billingHandler } from '@/server/modules/billing/http';

export const GET = withBoot(billingHandler);
