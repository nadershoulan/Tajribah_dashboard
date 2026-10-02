/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P3.10 — professional 3D models, up to the payment step: the merchant asks for one product's model,
 * staff quote a price (VAT on top), the merchant is told and sees the total, and may cancel before
 * work starts. One open order per product, even for two asks at once. Each step in the trails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { auditLogs, notifications, products, professionalOrders, staffAudit, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { cancelOrder, listOrders, requestOrder } from '@/server/modules/professional/service';
import { professionalQueue, quoteOrder } from '@/server/modules/admin/professional';
import type { StaffContext } from '@/server/modules/admin/access';

setLogLevel('error');

async function store(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  const [product] = (await harness.asAdmin(() => harness.db.insert(products).values({ tenantId: seeded.tenantId, name: 'Arc lamp', nameAr: 'مصباح القوس', productType: 'other' } as any).returning())) as any[];
  return { ...seeded, ctx, product };
}

async function staffMember(harness: TestDb): Promise<StaffContext> {
  const id = uuidv7();
  await harness.asAdmin(() => harness.db.insert(users).values({ id, email: 'staff@tajribah.test', passwordHash: 'x', fullName: 'Staff', isStaff: true, totpEnabled: true } as any));
  return { userId: id, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'staff-req' };
}

test('the merchant asks; staff see it first in the queue and quote; the merchant is told and sees price, VAT and total', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, product } = await store(harness, 'oud');
    const staff = await staffMember(harness);
    const asked = await requestOrder(ctx, { productId: product.id, note: '  A brass finish — the reflections matter.  ' });
    assert.deepEqual([asked.status, asked.note, asked.quote, asked.productNameAr], ['requested', 'A brass finish — the reflections matter.', null, 'مصباح القوس']);

    const queue = await professionalQueue('requested');
    assert.equal(queue.counts.requested, 1);
    assert.deepEqual([queue.rows[0]!.id, queue.rows[0]!.store.name, queue.rows[0]!.product.photos], [asked.id, 'oud', 0], 'staff see the store and the product');

    await assert.rejects(() => quoteOrder(staff, asked.id, { priceMinor: 50 }), (e: any) => !!e.errors?.priceMinor, 'at least 1 riyal');
    await assert.rejects(() => quoteOrder(staff, asked.id, { priceMinor: 45_000.5 }), (e: any) => !!e.errors?.priceMinor, 'whole halalas');
    const quoted = await quoteOrder(staff, asked.id, { priceMinor: 45_000, note: 'Ready in five working days.' });
    assert.deepEqual(quoted.quote && [quoted.quote.priceMinor, quoted.quote.vatMinor, quoted.quote.totalMinor, quoted.quote.note], [45_000, 6_750, 51_750, 'Ready in five working days.'], '450 riyals + 15% VAT');
    assert.equal(quoted.status, 'quoted');
    assert.equal((await listOrders(ctx))[0]!.quote?.totalMinor, 51_750, 'the merchant sees it');
    const bell = await harness.asAdmin(() => harness.db.select().from(notifications).where(and(eq(notifications.tenantId, tenantId), eq(notifications.type, 'professional.quoted')))) as any[];
    assert.equal(bell.length, 1, 'the owner is told');
    assert.match(bell[0].bodyEn, /450\.00/);

    const requote = await quoteOrder(staff, asked.id, { priceMinor: 40_000 });
    assert.equal(requote.quote?.priceMinor, 40_000, 'a quote can be revised before it is paid');
    const staffTrail = await harness.asAdmin(() => harness.db.select().from(staffAudit).where(eq(staffAudit.targetId, asked.id))) as any[];
    assert.equal(staffTrail.length, 2, 'each quote in the staff trail');
    const storeTrail = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceId, asked.id))) as any[];
    assert.equal(storeTrail.length, 3, 'the ask and both quotes in the store’s own activity');
  } finally { await harness.close(); }
});

test('one open order per product — even two asks at once; cancelled before work starts, it can be asked again', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, product } = await store(harness, 'oud2');
    const staff = await staffMember(harness);
    const first = await requestOrder(ctx, { productId: product.id });
    await assert.rejects(() => requestOrder(ctx, { productId: product.id }), (e: any) => e.code === 'conflict');
    await assert.rejects(
      () => harness.asAdmin(() => harness.db.insert(professionalOrders).values({ id: uuidv7(), tenantId, productId: product.id, status: 'quoted' } as any)),
      (e: any) => JSON.stringify(e).includes('professional_orders_open_unq') || /unique/i.test(String(e?.cause ?? e)),
      'the database itself refuses a second open order');

    const cancelled = await cancelOrder(ctx, first.id);
    assert.equal(cancelled.status, 'cancelled');
    await assert.rejects(() => cancelOrder(ctx, first.id), (e: any) => e.code === 'conflict', 'once is enough');
    await assert.rejects(() => quoteOrder(staff, first.id, { priceMinor: 10_000 }), (e: any) => e.code === 'conflict', 'a cancelled order is not quoted');
    const again = await requestOrder(ctx, { productId: product.id });
    assert.equal(again.status, 'requested', 'a new ask after a cancel');

    await harness.asAdmin(() => harness.db.update(professionalOrders).set({ status: 'accepted' } as any).where(eq(professionalOrders.id, again.id)));
    await assert.rejects(() => cancelOrder(ctx, again.id), (e: any) => e.code === 'conflict', 'not once work has started (paid)');
    await assert.rejects(() => quoteOrder(staff, again.id, { priceMinor: 10_000 }), (e: any) => e.code === 'conflict', 'nor re-quoted');
  } finally { await harness.close(); }
});

test('only someone who may change models asks or cancels; a store sees and touches only its own', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId, product } = await store(harness, 'oud3');
    const other = await store(harness, 'other');
    const viewerId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: viewerId, email: 'v@oud.sa', passwordHash: 'x', fullName: 'V' } as any);
      await harness.db.insert(tenantMemberships).values({ tenantId, userId: viewerId, role: 'viewer' } as any);
    });
    const viewer = await buildTenantContext({ actor: { userId: viewerId, email: 'v@oud.sa', isStaff: false }, tenantId, requestId: 'r' });
    await assert.rejects(() => requestOrder(viewer, { productId: product.id }), (e: any) => e.code === 'forbidden');
    const order = await requestOrder(ctx, { productId: product.id, note: null });
    assert.equal((await listOrders(viewer)).length, 1, 'a viewer can see it');
    await assert.rejects(() => cancelOrder(viewer, order.id), (e: any) => e.code === 'forbidden');

    await assert.rejects(() => requestOrder(other.ctx, { productId: product.id }), (e: any) => e.code === 'not_found', 'another store’s product does not exist');
    await assert.rejects(() => cancelOrder(other.ctx, order.id), (e: any) => e.code === 'not_found');
    assert.equal((await listOrders(other.ctx)).length, 0);
    await assert.rejects(() => requestOrder(ctx, { productId: product.id, note: 'x'.repeat(1001) }), (e: any) => !!e.errors?.note);
    await assert.rejects(() => requestOrder(ctx, { productId: product.id, extra: 1 }), (e: any) => e.code === 'validation_failed');
    const [gone] = (await harness.asAdmin(() => harness.db.insert(products).values({ tenantId, name: 'Old lamp', productType: 'other', deletedAt: new Date() } as any).returning())) as any[];
    await assert.rejects(() => requestOrder(ctx, { productId: gone.id }), (e: any) => e.code === 'not_found', 'a deleted product cannot be ordered');
  } finally { await harness.close(); }
});
