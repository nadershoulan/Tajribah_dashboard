// API-102 — POST /api/ar-configs/[productId]/publish
import { withBoot } from '@/server/boot';
import { publishArConfigHandler } from '@/server/modules/ar/http';

export const POST = withBoot(publishArConfigHandler);
