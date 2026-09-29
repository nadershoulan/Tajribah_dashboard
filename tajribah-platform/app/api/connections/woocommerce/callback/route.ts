// API-064 — POST /api/connections/woocommerce/callback (WooCommerce’s server) (P6)
import { withBoot } from '@/server/boot';
import { wooCallbackHandler } from '@/server/modules/connections/http';

export const POST = withBoot(wooCallbackHandler);
