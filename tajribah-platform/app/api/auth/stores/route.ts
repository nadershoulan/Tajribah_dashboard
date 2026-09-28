// API-017 — POST /api/auth/stores (P6, T30): add another store and act for it
import { withBoot } from '@/server/boot';
import { addStoreHandler } from '@/server/modules/auth/http';

export const POST = withBoot(addStoreHandler);
