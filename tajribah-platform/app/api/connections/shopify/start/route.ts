// API-066 — POST /api/connections/shopify/start (P6)
import { withBoot } from '@/server/boot';
import { startShopifyConnectHandler } from '@/server/modules/connections/http';

export const POST = withBoot(startShopifyConnectHandler);
