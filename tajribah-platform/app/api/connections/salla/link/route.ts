// API-069 — POST /api/connections/salla/link (T61)
import { withBoot } from '@/server/boot';
import { linkSallaHandler } from '@/server/modules/connections/http';

export const POST = withBoot(linkSallaHandler);
