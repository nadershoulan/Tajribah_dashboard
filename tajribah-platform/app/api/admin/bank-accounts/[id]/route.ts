// API-A81/A82 — PATCH, DELETE /api/admin/bank-accounts/[id] (T129)
import { withBoot } from '@/server/boot';
import { deleteBankAccountHandler, updateBankAccountHandler } from '@/server/modules/admin/http';

export const PATCH = withBoot(updateBankAccountHandler);
export const DELETE = withBoot(deleteBankAccountHandler);
