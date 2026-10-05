// API-188 — POST /api/tryon/[productId]/images/from-store (T80)
import { withBoot } from '@/server/boot';
import { cutoutFromStoreHandler } from '@/server/modules/tryon/http';

export const POST = withBoot(cutoutFromStoreHandler);
