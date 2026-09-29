// API-A39 — PUT /api/admin/ai/guardrails (P6.7)
import { withBoot } from '@/server/boot';
import { setGuardrailsHandler } from '@/server/modules/admin/http';

export const PUT = withBoot(setGuardrailsHandler);
