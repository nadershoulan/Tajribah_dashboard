// API-102 — POST /api/ar-configs/[productId]/publish · API-103 — DELETE (T40)
import { withBoot } from '@/server/boot';
import { publishArConfigHandler, unpublishArConfigHandler } from '@/server/modules/ar/http';

export const POST = withBoot(publishArConfigHandler);
export const DELETE = withBoot(unpublishArConfigHandler);
