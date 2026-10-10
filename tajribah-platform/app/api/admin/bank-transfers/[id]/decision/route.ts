// API-A76 — POST /api/admin/bank-transfers/[id]/decision: approve, decline, ask for more, note (T129)
import { withBoot } from '@/server/boot';
import { transferDecisionHandler } from '@/server/modules/admin/http';

export const POST = withBoot(transferDecisionHandler);
