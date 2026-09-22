// API-021 — POST /api/onboarding/skip
import { withBoot } from '@/server/boot';
import { skipStepHandler } from '@/server/modules/onboarding/http';

export const POST = withBoot(skipStepHandler);
