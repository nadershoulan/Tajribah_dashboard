/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Document, WebIO } from '@gltf-transform/core';
import { storeConnections, syncJobs, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { setEmailSender } from '@/server/core/notify/notify';
import { MemoryStorage, setStorage, storage } from '@/server/core/storage/storage';
import { buildTenantContext, systemContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { confirmUpload, startUpload } from '@/server/modules/models/service';
import { processVersion } from '@/server/modules/models/process';
import { markSyncFailed } from '@/server/modules/sync/engine';
import { acceptInvitation, invite } from '@/server/modules/team/service';
import { markRead, myNotifications, notifyIn } from '@/server/modules/notifications/service';

setLogLevel('error');
const admin = <T>(harness: TestDb, fn: () => Promise<T>) => harness.asAdmin(fn);
const sent: any[] = [];
setEmailSender({ async send(m: any) { sent.push(m); } } as any);

async function store(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  return { ...seeded, ctx: await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` }) };
}
async function member(harness: TestDb, tenantId: string, email: string, role: string) {
  const userId = uuidv7();
  await admin(harness, async () => {
    await harness.db.insert(users).values({ id: userId, email, passwordHash: 'x', fullName: email } as any);
    await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId, userId, role, status: 'active' } as any);
  });
  return { userId, ctx: await buildTenantContext({ actor: { userId, email, isStaff: false }, tenantId, requestId: `r-${email}` }) };
}

test('each person gets their own copy, by permission or by name; reading is personal', async () => {
  const harness = await createTestDb();
  try {
    const owner = await store(harness, 'alpha');
    const analyst = await member(harness, owner.tenantId, 'an@example.test', 'analyst');
    await withTenant(owner.tenantId, (db) => notifyIn(db, { type: 't.billing', permission: 'billing:read', title: { ar: 'فاتورة', en: 'Invoice' } }));
    await withTenant(owner.tenantId, (db) => notifyIn(db, { type: 't.all', permission: 'products:read', title: { ar: 'للكل', en: 'Everyone' }, level: 'warning' }));
    await withTenant(owner.tenantId, (db) => notifyIn(db, { type: 't.one', userIds: [analyst.userId], title: { ar: 'لك', en: 'Just you' } }));

    const mine = await myNotifications(owner.ctx);
    assert.deepEqual(mine.items.map((n) => n.type).sort(), ['t.all', 't.billing']);
    const theirs = await myNotifications(analyst.ctx);
    assert.deepEqual(theirs.items.map((n) => n.type).sort(), ['t.all', 't.one'], 'an analyst has no billing:read');
    assert.equal(theirs.unread, 2);

    const everyone = theirs.items.find((n) => n.type === 't.all')!;
    assert.equal(await markRead(analyst.ctx, [everyone.id]), 1);
    assert.equal((await myNotifications(analyst.ctx)).unread, 1);
    assert.equal((await myNotifications(owner.ctx)).unread, 2, "the owner's copy is still unread");
    const ownerCopy = (await myNotifications(owner.ctx)).items[0];
    assert.equal(await markRead(analyst.ctx, [ownerCopy.id]), 0, "nobody can mark someone else's");
    assert.equal(await markRead(owner.ctx, 'all'), 2);
    assert.equal((await myNotifications(owner.ctx)).unread, 0);

    const other = await store(harness, 'beta');
    assert.deepEqual((await myNotifications(other.ctx)).items, [], 'another store sees none of it');
  } finally { await harness.close(); }
});

test('the real events notify: a model ready, a failed sync, an invitation accepted', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const owner = await store(harness, 'alpha');
    // model ready
    const doc = new Document();
    const pos = doc.createAccessor().setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])).setBuffer(doc.createBuffer());
    const scene = doc.createScene();
    scene.addChild(doc.createNode().setMesh(doc.createMesh().addPrimitive(doc.createPrimitive().setAttribute('POSITION', pos))));
    doc.getRoot().setDefaultScene(scene);
    const bytes = await new WebIO().writeBinary(doc);
    const up = await startUpload(owner.ctx, { filename: 'lamp.glb', sizeBytes: bytes.byteLength });
    await storage().put(up.uploadUrl.replace('memory://upload/', ''), bytes.buffer.slice(0) as ArrayBuffer);
    await confirmUpload(owner.ctx, up.versionId);
    await processVersion(owner.tenantId, up.versionId, 'r');
    // failed sync
    const conn = uuidv7(); const job = uuidv7();
    await admin(harness, async () => {
      await harness.db.insert(storeConnections).values({ id: conn, tenantId: owner.tenantId, provider: 'salla', externalStoreId: 's' } as any);
      await harness.db.insert(syncJobs).values({ id: job, tenantId: owner.tenantId, connectionId: conn, type: 'full', status: 'running' } as any);
    });
    await markSyncFailed(await systemContext({ tenantId: owner.tenantId, requestId: 'r', permissions: ['connections:read'] }), job, 'store is down');
    // invitation accepted (the store has room: owner + 1 on Starter)
    await invite(owner.ctx, { email: 'sara@example.test', role: 'editor' }, { authSecret: 's'.repeat(40), appUrl: 'https://a.test' });
    const token = sent.at(-1).text.match(/\/invite\/([A-Za-z0-9_-]+)/)[1];
    const sara = uuidv7();
    await admin(harness, () => harness.db.insert(users).values({ id: sara, email: 'sara@example.test', passwordHash: 'x', fullName: 'Sara' } as any));
    await acceptInvitation({ token, userId: sara, authSecret: 's'.repeat(40) });

    const got = (await myNotifications(owner.ctx)).items;
    assert.deepEqual(got.map((n) => [n.type, n.level]).sort(), [['model.ready', 'success'], ['sync.failed', 'error'], ['team.joined', 'success']]);
    assert.equal(got.find((n) => n.type === 'sync.failed')!.body?.en, 'store is down');
    assert.equal(got.find((n) => n.type === 'model.ready')!.href, '/dashboard/models');
  } finally { await harness.close(); }
});
