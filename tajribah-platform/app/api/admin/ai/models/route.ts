// API-A40/A41 — GET, POST /api/admin/ai/models (P6)
import { withBoot } from '@/server/boot';
import { listModelsHandler, registerModelHandler } from '@/server/modules/admin/http';

export const GET = withBoot(listModelsHandler);
export const POST = withBoot(registerModelHandler);
