// API-204/205 — PATCH, DELETE /api/billing/transfers/[id]: send again, cancel (T129)
import { withBoot } from '@/server/boot';
import { cancelTransferHandler, resubmitTransferHandler } from '@/server/modules/billing/http';

export const PATCH = withBoot(resubmitTransferHandler);
export const DELETE = withBoot(cancelTransferHandler);
