// API-062 — DELETE /api/connections/[id]
import { withBoot } from '@/server/boot';
import { disconnectHandler } from '@/server/modules/connections/http';

export const DELETE = withBoot(disconnectHandler);
