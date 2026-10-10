// API-A78 — GET /api/admin/payment-methods: methods, bank transfer settings, accounts (T129)
import { withBoot } from '@/server/boot';
import { paymentSettingsHandler } from '@/server/modules/admin/http';

export const GET = withBoot(paymentSettingsHandler);
