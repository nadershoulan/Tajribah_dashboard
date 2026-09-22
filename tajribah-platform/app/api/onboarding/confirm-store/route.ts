// API-023 — POST /api/onboarding/confirm-store
import { withBoot } from '@/server/boot';
import { confirmStoreHandler } from '@/server/modules/onboarding/http';

export const POST = withBoot(confirmStoreHandler);
