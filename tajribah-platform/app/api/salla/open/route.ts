// API-068 — POST /api/salla/open (T61: the app page inside the Salla dashboard)
import { withBoot } from '@/server/boot';
import { openSallaAppHandler } from '@/server/modules/connections/http';

export const POST = withBoot(openSallaAppHandler);
