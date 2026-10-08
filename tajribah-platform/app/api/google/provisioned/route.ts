// API-183 — GET /api/google/provisioned (T121)
import { withBoot } from '@/server/boot';
import { googleProvisionedHandler } from '@/server/modules/google/http';

export const GET = withBoot(googleProvisionedHandler);
