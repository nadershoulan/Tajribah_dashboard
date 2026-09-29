// API-063 — POST /api/connections/woocommerce/start (P6)
import { withBoot } from '@/server/boot';
import { startWooConnectHandler } from '@/server/modules/connections/http';

export const POST = withBoot(startWooConnectHandler);
