// API-067 — POST /api/connections/shopify/complete (P6)
import { withBoot } from '@/server/boot';
import { completeShopifyConnectHandler } from '@/server/modules/connections/http';

export const POST = withBoot(completeShopifyConnectHandler);
