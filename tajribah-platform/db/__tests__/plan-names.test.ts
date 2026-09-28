/**
 * T32 — after every migration, the plan catalogue in the database names each plan exactly as
 * lib/plans.ts does (the admin console shows the database's names, the screens show lib's).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plans } from '@/db/schema';
import { PLANS } from '@/lib/plans';
import { createTestDb } from '@/server/testing/harness';

test('the catalogue rows carry the same names as lib/plans.ts, in both languages', async () => {
  const harness = await createTestDb();
  try {
    const rows = await harness.asAdmin(() => harness.db.select().from(plans));
    const stored = Object.fromEntries(rows.map((r) => [r.code, [r.name, r.nameAr]]));
    for (const plan of PLANS) assert.deepEqual(stored[plan.code], [plan.name.en, plan.name.ar], plan.code);
    assert.equal(stored.starter?.[1], 'البداية', 'the Starter plan is «البداية» (T32)');
  } finally { await harness.close(); }
});
