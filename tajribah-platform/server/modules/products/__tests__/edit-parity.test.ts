/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P1.10 — the form's rules (lib/product-edit.ts) and the API's must give the same answer.
 * Every edit below goes to the real service and to `editErrors`: both accept, or both refuse
 * on the same fields. A rule changed on one side only turns this red.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import { createProduct, updateProduct } from '@/server/modules/products/service';
import { editErrors, type ProductEdit } from '@/lib/product-edit';

setLogLevel('error');

const CASES: { name: string; start: any; edit: ProductEdit }[] = [
  { name: 'AR on, no size', start: {}, edit: { arEnabled: true } },
  { name: 'AR on, width only', start: {}, edit: { arEnabled: true, dimensions: { widthMm: 40 } } },
  { name: 'AR on, width + height', start: {}, edit: { arEnabled: true, dimensions: { widthMm: 40, heightMm: 48 } } },
  { name: 'size removed while AR is on', start: { dimensions: { widthMm: 40, heightMm: 48 }, ar: true }, edit: { dimensions: null } },
  { name: 'over 3 m', start: {}, edit: { dimensions: { widthMm: 3001 } } },
  { name: 'exactly 3 m', start: {}, edit: { dimensions: { widthMm: 3000, heightMm: 10 } } },
  { name: 'zero', start: {}, edit: { dimensions: { heightMm: 0 } } },
  { name: 'type change', start: {}, edit: { productType: 'bag' } },
  { name: 'AR off with no size', start: {}, edit: { arEnabled: false, dimensions: null } },
];

test('the form and the API agree on every edit', async () => {
  const harness = await createTestDb();
  try {
    const seeded = await seedTenant(harness, 'alpha');
    const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: 'r' });
    for (const c of CASES) {
      let row = await createProduct(ctx, { name: c.name, ...(c.start.dimensions ? { dimensions: c.start.dimensions } : {}) });
      if (c.start.ar) row = await updateProduct(ctx, row.id, { arEnabled: true });
      const client = Object.keys(editErrors(row, c.edit)).sort();
      let server: string[] = [];
      try { await updateProduct(ctx, row.id, c.edit); } catch (error: any) {
        assert.equal(error.code, 'validation_failed', `${c.name}: ${error.message}`);
        server = Object.keys(error.errors).sort();
      }
      assert.deepEqual(client, server, `${c.name}: form says ${JSON.stringify(client)}, API says ${JSON.stringify(server)}`);
    }
  } finally { await harness.close(); }
});
