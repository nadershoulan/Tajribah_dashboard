/* eslint-disable @typescript-eslint/no-explicit-any */
// Filed in STATE.md (P1.12): a draft whose bytes never arrive stayed `draft` forever.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, models3d, modelVersions, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage, storage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { confirmUpload, startUpload } from '@/server/modules/models/service';
import { DRAFT_TTL_MS, expireStaleDrafts } from '@/server/modules/models/cleanup';

setLogLevel('error');
const admin = <T>(harness: TestDb, fn: () => Promise<T>) => harness.asAdmin(fn);

/** A minimal, valid glTF 2.0 binary: 12-byte header, then the JSON chunk. */
function glb(json = '{"asset":{"version":"2.0"}}'): Uint8Array {
  const text = new TextEncoder().encode(json);
  const padded = Math.ceil(text.byteLength / 4) * 4;
  const bytes = new Uint8Array(12 + 8 + padded).fill(0x20, 20);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x46546c67, true);
  view.setUint32(4, 2, true);
  view.setUint32(8, bytes.byteLength, true);
  view.setUint32(12, padded, true);
  view.setUint32(16, 0x4e4f534a, true);
  bytes.set(text, 20);
  return bytes;
}

async function merchant(harness: TestDb, name: string, role: 'owner' | 'viewer' = 'owner') {
  const seeded = await seedTenant(harness, name);
  let userId = seeded.userId;
  if (role !== 'owner') {
    userId = uuidv7();
    await admin(harness, async () => {
      await harness.db.insert(users).values({ id: userId, email: `${role}-${name}@example.test`, passwordHash: 'x', fullName: role } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: seeded.tenantId, userId, role, status: 'active' } as any);
    });
  }
  const ctx = await buildTenantContext({ actor: { userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx };
}

/** What the browser does with the presigned URL. */
async function putBytes(uploadUrl: string, bytes: Uint8Array, contentType: string) {
  const key = uploadUrl.replace('memory://upload/', '');
  await storage().put(key, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer, { contentType });
  return key;
}

const DAY = 86_400_000;
const versionOf = async (harness: TestDb, id: string) =>
  ((await admin(harness, () => harness.db.select().from(modelVersions).where(eq(modelVersions.id, id)))) as any[])[0];
const modelOf = async (harness: TestDb, id: string) =>
  ((await admin(harness, () => harness.db.select().from(models3d).where(eq(models3d.id, id)))) as any[])[0];
const backdate = (harness: TestDb, id: string, ms: number) =>
  admin(harness, () => harness.db.update(modelVersions).set({ createdAt: new Date(Date.now() - ms) } as any).where(eq(modelVersions.id, id)));

test('a draft abandoned for a day is failed, its bytes deleted, and the change audited as the platform\'s', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx } = await merchant(harness, 'alpha');
    const bytes = glb();
    // Abandoned: the bytes even arrived, but nobody confirmed.
    const abandoned = await startUpload(ctx, { filename: 'lost.glb', sizeBytes: bytes.byteLength });
    const key = await putBytes(abandoned.uploadUrl, bytes, abandoned.contentType);
    await backdate(harness, abandoned.versionId, DRAFT_TTL_MS + 60_000);
    // Recent draft: the merchant may still be uploading.
    const recent = await startUpload(ctx, { filename: 'fresh.glb', sizeBytes: bytes.byteLength });
    await backdate(harness, recent.versionId, DRAFT_TTL_MS - 60_000);
    // Old but confirmed: not a draft, not ours to touch.
    const confirmed = await startUpload(ctx, { filename: 'kept.glb', sizeBytes: bytes.byteLength });
    await putBytes(confirmed.uploadUrl, bytes, confirmed.contentType);
    await confirmUpload(ctx, confirmed.versionId);
    await backdate(harness, confirmed.versionId, 2 * DAY);

    assert.deepEqual(await expireStaleDrafts(), { expired: 1 });
    assert.equal((await versionOf(harness, abandoned.versionId)).status, 'failed');
    assert.equal((await modelOf(harness, abandoned.modelId)).status, 'failed', 'a model with nothing else shows its only upload failed');
    assert.equal(await storage().head(key), null, 'bytes nobody confirmed are not kept');
    assert.equal((await versionOf(harness, recent.versionId)).status, 'draft', 'a recent draft is left alone');
    assert.equal((await versionOf(harness, confirmed.versionId)).status, 'processing');

    const trail = (await admin(harness, () => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceId, abandoned.versionId)))) as any[];
    const expiry = trail.find((row) => row.changes?.after?.status === 'failed');
    assert.ok(expiry, 'the expiry is audited');
    assert.equal(expiry.actorType, 'system');

    assert.deepEqual(await expireStaleDrafts(), { expired: 0 }, 'a second tick finds nothing');
  } finally { await harness.close(); }
});

test('an abandoned new version does not mark a live model failed', async () => {
  const harness = await createTestDb();
  setStorage(new MemoryStorage());
  try {
    const { ctx } = await merchant(harness, 'alpha');
    const bytes = glb();
    const v1 = await startUpload(ctx, { filename: 'watch.glb', sizeBytes: bytes.byteLength });
    await admin(harness, () => harness.db.update(models3d).set({ currentVersionId: v1.versionId, status: 'ready' } as any).where(eq(models3d.id, v1.modelId)));
    await admin(harness, () => harness.db.update(modelVersions).set({ status: 'ready' } as any).where(eq(modelVersions.id, v1.versionId)));
    const v2 = await startUpload(ctx, { filename: 'watch.glb', sizeBytes: bytes.byteLength, modelId: v1.modelId });
    await backdate(harness, v2.versionId, DRAFT_TTL_MS + 60_000);

    assert.deepEqual(await expireStaleDrafts(), { expired: 1 });
    assert.equal((await versionOf(harness, v2.versionId)).status, 'failed');
    assert.equal((await modelOf(harness, v1.modelId)).status, 'ready', 'the live model keeps showing');
  } finally { await harness.close(); }
});
