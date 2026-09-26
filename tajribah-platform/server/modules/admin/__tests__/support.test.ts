/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A12 — support: one box for any id, email, invoice number, name or request id; a request id
 * shows everything that request did (store trails and the staff trail, in order); a store's
 * activity trail; field names, never values.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, invoices, jobs, tenants, users, webhookEvents } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import { actOnStore } from '@/server/modules/admin/actions';
import { lookup, requestTrail, storeActivity } from '@/server/modules/admin/support';

setLogLevel('error');

test('one box: ids of every kind, an email, an invoice number, a name or address; deleted things stay hidden', async () => {
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const gone = await seedTenant(harness, 'bravo');
    await harness.asAdmin(async () => {
      await harness.db.update(tenants).set({ name: 'Oud House', nameAr: 'بيت العود', slug: 'oud-house' }).where(eq(tenants.id, store.tenantId));
      await harness.db.update(tenants).set({ name: 'Oud Gone', deletedAt: new Date() }).where(eq(tenants.id, gone.tenantId));
    });
    const invoiceId = uuidv7();
    const jobId = uuidv7();
    const deliveryId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(invoices).values({ id: invoiceId, tenantId: store.tenantId, invoiceNumber: 'TJ-2026-ABCDEF12-000001', status: 'issued', subtotalMinor: 100, vatMinor: 15, totalMinor: 115 } as any);
      await harness.db.insert(jobs).values({ id: jobId, queue: 'sync.products', tenantId: store.tenantId, state: 'dead' } as any);
      await harness.db.insert(webhookEvents).values({ id: deliveryId, tenantId: store.tenantId, provider: 'zid', providerEventId: 'e1', topic: 'order.created', signatureValid: true, status: 'failed' } as any);
    });

    assert.deepEqual((await lookup(store.tenantId)).stores.map((s) => s.slug), ['oud-house']);
    assert.deepEqual((await lookup(store.tenantId.toUpperCase())).stores.length, 1, 'an id in capitals still finds it');
    assert.deepEqual((await lookup(store.userId)).people.map((p) => p.id), [store.userId]);
    const byInvoiceId = await lookup(invoiceId);
    assert.deepEqual([byInvoiceId.kind, byInvoiceId.invoices[0]?.number, byInvoiceId.invoices[0]?.store.id], ['id', 'TJ-2026-ABCDEF12-000001', store.tenantId]);
    assert.deepEqual((await lookup(jobId)).jobs.map((j) => [j.queue, j.state]), [['sync.products', 'dead']]);
    assert.deepEqual((await lookup(deliveryId)).deliveries.map((d) => [d.topic, d.status]), [['order.created', 'failed']]);
    assert.deepEqual((await lookup(gone.tenantId)).stores, [], 'a deleted store is not found');

    const byEmail = await lookup(`  ${store.email.toUpperCase()} `);
    assert.deepEqual([byEmail.kind, byEmail.people.map((p) => p.id)], ['email', [store.userId]], 'exact email, any case');
    assert.deepEqual((await lookup('owner%@x')).people, [], '% is a character in an email');
    const [a1, a2] = [uuidv7(), uuidv7()];
    await harness.asAdmin(() => harness.db.insert(users).values([
      { id: a1, email: 'a@oud.sa', passwordHash: 'x', fullName: 'A' }, { id: a2, email: 'ba@oud.sa', passwordHash: 'x', fullName: 'B' },
    ] as any));
    assert.deepEqual((await lookup('a@oud.sa')).people.map((p) => p.id), [a1], 'an email is exact: ba@oud.sa is someone else');
    assert.deepEqual((await lookup('tj-2026-abcdef12-000001')).invoices.map((i) => i.id), [invoiceId], 'invoice number, any case');
    assert.deepEqual((await lookup('العود')).stores.map((s) => s.id), [store.tenantId], 'the Arabic name');
    assert.deepEqual((await lookup('oud')).stores.map((s) => s.id), [store.tenantId], 'the deleted "Oud Gone" is not listed');
    await assert.rejects(() => lookup(' x '), (e: any) => e.code === 'validation_failed');
  } finally { await harness.close(); }
});

test('a request id: everything it did, store and staff trails, in order, with who did it — field names, not values', async () => {
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const other = await seedTenant(harness, 'bravo');
    const staffId = uuidv7();
    await harness.asAdmin(() => harness.db.insert(users).values({ id: staffId, email: 'staff@tajribah.test', passwordHash: 'x', fullName: 'Staff', isStaff: true } as any));
    await actOnStore({ userId: staffId, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'req-support-0001' }, store.tenantId, { type: 'suspend', reason: 'abuse report #7' });
    await harness.asAdmin(() => harness.db.insert(auditLogs).values([
      { tenantId: other.tenantId, actorUserId: other.userId, actorType: 'user', action: 'update', resourceType: 'product', resourceId: 'p1', changes: { before: { price: 1 }, after: { price: 2, secretNote: 'do not show' } }, requestId: 'req-other-0002' },
    ] as any));

    const trail = await requestTrail('req-support-0001');
    assert.deepEqual(trail.map((e) => [e.source, e.action, e.actor, e.store?.id]), [
      ['store', 'update', 'staff@tajribah.test', store.tenantId],
      ['staff', 'store.suspend', 'staff@tajribah.test', store.tenantId],
    ]);
    assert.deepEqual(trail[0]!.fields, ['status']);
    assert.equal(trail[1]!.reason, 'abuse report #7');
    assert.deepEqual((await lookup('req-support-0001')).request.length, 2, 'the box finds a request id');
    assert.deepEqual((await lookup('req-nothing-0003')).request, []);

    const other2 = await requestTrail('req-other-0002');
    assert.deepEqual(other2[0]!.fields, ['price', 'secretNote']);
    assert.ok(!JSON.stringify(other2).includes('do not show'), 'values never leave the trail');
  } finally { await harness.close(); }
});

test('a store’s activity: newest first, paged, its own rows only; a deleted or unknown store is not found', async () => {
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const other = await seedTenant(harness, 'bravo');
    const row = (tenantId: string, resourceId: string) => ({ id: uuidv7(), tenantId, actorUserId: store.userId, actorType: 'user', action: 'create', resourceType: 'product', resourceId });
    // One at a time, as separate requests write them: uuidv7 orders across milliseconds, not within one.
    for (const [tenantId, id] of [[store.tenantId, 'a'], [store.tenantId, 'b'], [other.tenantId, 'x'], [store.tenantId, 'c']] as const) {
      await new Promise((r) => setTimeout(r, 3));
      await harness.asAdmin(() => harness.db.insert(auditLogs).values(row(tenantId, id) as any));
    }

    const first = await storeActivity(store.tenantId, { limit: 2 });
    assert.deepEqual(first.entries.map((e) => e.resourceId), ['c', 'b']);
    assert.equal(first.entries[0]!.actor, store.email);
    const second = await storeActivity(store.tenantId, { limit: 2, before: first.next! });
    assert.deepEqual(second.entries.map((e) => e.resourceId), ['a']);
    assert.equal(second.next, null);

    await assert.rejects(() => storeActivity(uuidv7()), (e: any) => e.code === 'not_found');
    await harness.asAdmin(() => harness.db.update(tenants).set({ deletedAt: new Date() }).where(eq(tenants.id, other.tenantId)));
    await assert.rejects(() => storeActivity(other.tenantId), (e: any) => e.code === 'not_found');
  } finally { await harness.close(); }
});
