// API-091 — POST /api/settings/domain/check (T62)
import { withBoot } from '@/server/boot';
import { checkCustomDomainHandler } from '@/server/modules/domains/http';

export const POST = withBoot(checkCustomDomainHandler);
