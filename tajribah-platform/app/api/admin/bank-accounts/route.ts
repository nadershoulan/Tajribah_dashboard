// API-A80 — POST /api/admin/bank-accounts: add one of Tajribah's accounts (T129)
import { withBoot } from '@/server/boot';
import { createBankAccountHandler } from '@/server/modules/admin/http';

export const POST = withBoot(createBankAccountHandler);
