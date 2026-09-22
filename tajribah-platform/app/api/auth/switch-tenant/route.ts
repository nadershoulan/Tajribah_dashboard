// API-006 — POST /api/auth/switch-tenant
import { withBoot } from '@/server/boot';
import { switchTenantHandler } from '@/server/modules/auth/http';

export const POST = withBoot(switchTenantHandler);
