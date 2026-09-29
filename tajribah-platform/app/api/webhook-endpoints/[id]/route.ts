// API-172 — PATCH /api/webhook-endpoints/[id] · API-173 — DELETE (P8, outgoing webhooks)
import { withBoot } from '@/server/boot';
import { deleteEndpointHandler, updateEndpointHandler } from '@/server/modules/outgoing-webhooks/http';

export const PATCH = withBoot(updateEndpointHandler);
export const DELETE = withBoot(deleteEndpointHandler);
