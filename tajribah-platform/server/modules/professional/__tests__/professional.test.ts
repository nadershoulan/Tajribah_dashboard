/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P3.10 — professional 3D models, up to the payment step: the merchant asks for one product's model,
 * staff quote a price (VAT on top), the merchant is told and sees the total, and may cancel before
 * work starts. One open order per product, even for two asks at once. Each step in the trails.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { auditLogs, models3d, notifications, products, professionalOrders, staffAudit, tenantMemberships, users } from '@/db/schema';
import { Document, WebIO } from '@gltf-transform/core';
import { PRICE_TIERS } from '@/lib/contracts/professional';
import { MemoryStorage, setStorage, storage } from '@/server/core/storage/storage';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { acceptQuote, cancelOrder, listOrders, requestOrder } from '@/server/modules/professional/service';
import { confirmDelivery, markPaid, professionalQueue, quoteOrder, startDelivery } from '@/server/modules/admin/professional';
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

test('T68 before card payments: accept → staff record the transfer → a real model delivered into the product; the merchant told at each step', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx, tenantId, product } = await store(harness, 'oud4');
    const staff = await staffMember(harness);
    const order = await requestOrder(ctx, { productId: product.id });
    await assert.rejects(() => acceptQuote(ctx, order.id), (e: any) => e.code === 'conflict', 'nothing to accept before a quote');
    await quoteOrder(staff, order.id, { priceMinor: PRICE_TIERS[1]!.priceMinor });
    await assert.rejects(() => markPaid(staff, order.id, { reference: 'TRX-001' }), (e: any) => e.code === 'conflict', 'not paid before the merchant accepts');
    // Accepting commits the store to pay: an editor or an admin may ask, only the owner (billing) agrees.
    for (const role of ['editor', 'admin'] as const) {
      const id = uuidv7();
      await harness.asAdmin(async () => {
        await harness.db.insert(users).values({ id, email: `${role}@oud.sa`, passwordHash: 'x', fullName: role } as any);
        await harness.db.insert(tenantMemberships).values({ tenantId, userId: id, role } as any);
      });
      const member = await buildTenantContext({ actor: { userId: id, email: `${role}@oud.sa`, isStaff: false }, tenantId, requestId: 'r' });
      await assert.rejects(() => acceptQuote(member, order.id), (e: any) => e.code === 'forbidden', `${role} cannot agree to a price`);
    }
    const accepted = await acceptQuote(ctx, order.id);
    assert.ok(accepted.acceptedAt && accepted.status === 'quoted', 'accepted: waiting for the transfer');
    await assert.rejects(() => acceptQuote(ctx, order.id), (e: any) => e.code === 'conflict', 'once');
    await assert.rejects(() => quoteOrder(staff, order.id, { priceMinor: 1_000 }), (e: any) => e.code === 'conflict', 'an accepted price no longer changes');
    await assert.rejects(() => startDelivery(staff, order.id, { filename: 'm.glb', sizeBytes: 100 }), (e: any) => e.code === 'conflict', 'no work before payment');
    await assert.rejects(() => markPaid(staff, order.id, { reference: 'x' }), (e: any) => !!e.errors?.reference);

    const paid = await markPaid(staff, order.id, { reference: 'TRX-2026-0042' });
    assert.ok(paid.paidAt && paid.status === 'accepted', 'paid: in progress');
    await assert.rejects(() => cancelOrder(ctx, order.id), (e: any) => e.code === 'conflict', 'no cancelling once work started');

    const doc = new Document();
    const buffer = doc.createBuffer();
    const prim = doc.createPrimitive().setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 0.1, 0, 0, 0, 0.1, 0])).setBuffer(buffer));
    doc.getRoot().setDefaultScene(doc.createScene().addChild(doc.createNode('n').setMesh(doc.createMesh().addPrimitive(prim))));
    const glb = await new WebIO().writeBinary(doc);
    const started = await startDelivery(staff, order.id, { filename: 'lamp-pro.glb', sizeBytes: glb.byteLength });
    await storage().put(started.uploadUrl.replace('memory://upload/', ''), glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer, {});
    const other = await store(harness, 'oud5');
    const foreign = await requestOrder(other.ctx, { productId: other.product.id });
    await assert.rejects(() => confirmDelivery(staff, foreign.id, { versionId: started.versionId }), (e: any) => e.code === 'conflict', 'a file for another order is refused');
    const delivered = await confirmDelivery(staff, order.id, { versionId: started.versionId });
    assert.equal(delivered.status, 'delivered');
    const model = (await harness.asAdmin(() => harness.db.select().from(models3d).where(eq(models3d.id, delivered.deliveredModelId!))))[0] as any;
    assert.deepEqual([model.productId, model.source], [product.id, 'professional_service'], 'a model of the product, made by our team');
    const bell = await harness.asAdmin(() => harness.db.select().from(notifications).where(eq(notifications.tenantId, tenantId))) as any[];
    assert.deepEqual([...new Set(bell.map((n) => n.type).filter((ty) => ty.startsWith('professional.')))].sort(), ['professional.delivered', 'professional.paid', 'professional.quoted'].sort(), 'each step, to each member who may see models');
    assert.match(bell.find((n) => n.type === 'professional.paid').bodyEn, /5 working days/, 'the promised days of its tier');
  } finally { await harness.close(); }
});
