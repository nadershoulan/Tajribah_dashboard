// API-022 — POST /api/onboarding/unskip
import { withBoot } from '@/server/boot';
import { unskipStepHandler } from '@/server/modules/onboarding/http';

export const POST = withBoot(unskipStepHandler);
