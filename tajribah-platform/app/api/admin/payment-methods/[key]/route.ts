// API-A79 — PATCH /api/admin/payment-methods/[key]: switch on or off, move, set (T129)
import { withBoot } from '@/server/boot';
import { updatePaymentMethodHandler } from '@/server/modules/admin/http';

export const PATCH = withBoot(updatePaymentMethodHandler);
