// API-020 — GET /api/onboarding
import { withBoot } from '@/server/boot';
import { getOnboardingHandler } from '@/server/modules/onboarding/http';

export const GET = withBoot(getOnboardingHandler);
