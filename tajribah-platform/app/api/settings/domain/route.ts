// API-089 — GET · PUT · DELETE /api/settings/domain (T62)
import { withBoot } from '@/server/boot';
import { customDomainHandler, removeCustomDomainHandler, setCustomDomainHandler } from '@/server/modules/domains/http';

export const GET = withBoot(customDomainHandler);
export const PUT = withBoot(setCustomDomainHandler);
export const DELETE = withBoot(removeCustomDomainHandler);
