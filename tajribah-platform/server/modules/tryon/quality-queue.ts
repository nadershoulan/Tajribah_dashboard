/**
 * P5.9 — asking for a confirmed try-on picture to be checked. Apart from the check (`quality.ts`, which
 * loads `sharp`): the upload endpoint runs on Cloudflare Workers; the check runs on a Node worker.
 */
import { enqueue } from '@/server/core/jobs/queue';

export type Slot = 'worn' | 'flat';

export async function enqueueQuality(tenantId: string, productId: string, slot: Slot, key: string): Promise<void> {
  await enqueue({ queue: 'tryon.quality', tenantId, payload: { productId, slot, key }, dedupeKey: `tryon:${key}:quality` });
}
