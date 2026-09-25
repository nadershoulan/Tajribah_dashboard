/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, tenantMemberships, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { getSettings, updateSettings } from '@/server/modules/settings/service';

setLogLevel('error');
const code = (e: any) => e.code;

async function store(harness: TestDb, name: string, role: 'owner' | 'editor' = 'owner') {
  const seeded = await seedTenant(harness, name);
  let userId = seeded.userId;
  if (role !== 'owner') {
    userId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: userId, email: `${role}-${name}@example.test`, passwordHash: 'x', fullName: role } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: seeded.tenantId, userId, role, status: 'active' } as any);
    });
  }
  return { ...seeded, ctx: await buildTenantContext({ actor: { userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` }) };
}

test('one save writes identity and branding together, with one audit row; blank clears', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    const blank = await getSettings(ctx);
    assert.deepEqual([blank.crNumber, blank.vatNumber, blank.brandColor, blank.buttonRadius], [null, null, null, 12], 'nothing invented');

    const saved = await updateSettings(ctx, {
      nameAr: 'عود', crNumber: '١٠١٠١٢٣٤٥٦', vatNumber: '300000000000003', city: 'الرياض',
      brandColor: '#0B7A75', buttonRadius: 20, consentTextAr: 'الصورة تبقى على جهازك.',
    });
    assert.deepEqual([saved.nameAr, saved.crNumber, saved.vatNumber, saved.brandColor, saved.buttonRadius, saved.consentTextAr],
      ['عود', '1010123456', '300000000000003', '#0B7A75', 20, 'الصورة تبقى على جهازك.']);
    const trail = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceType, 'store_settings'))) as any[];
    assert.equal(trail.length, 1);
    assert.equal(trail[0].changes.after.crNumber, '1010123456');

    const cleared = await updateSettings(ctx, { crNumber: '', brandColor: '' });
    assert.deepEqual([cleared.crNumber, cleared.brandColor, cleared.vatNumber, cleared.buttonRadius], [null, null, '300000000000003', 20], 'only what was sent changes');
    await updateSettings(ctx, { brandColor: '#112233' });
    const cityOnly = await updateSettings(ctx, { city: 'جدة' });
    assert.deepEqual([cityOnly.city, cityOnly.brandColor, cityOnly.buttonRadius], ['جدة', '#112233', 20], 'a save that does not mention the colour keeps it');
  } finally { await harness.close(); }
});

test('a bad value is refused per field and nothing is saved', async () => {
  const harness = await createTestDb();
  try {
    const { ctx } = await store(harness, 'alpha');
    await assert.rejects(() => updateSettings(ctx, { name: 'Renamed', vatNumber: '12345' }), (e: any) => code(e) === 'validation_failed' && 'vatNumber' in e.errors);
    assert.notEqual((await getSettings(ctx)).name, 'Renamed', 'the valid half was not saved either');
  } finally { await harness.close(); }
});

test('an editor reads but cannot change settings; another store sees only its own', async () => {
  const harness = await createTestDb();
  try {
    const a = await store(harness, 'alpha');
    await updateSettings(a.ctx, { crNumber: '1010123456' });
    const editor = await store(harness, 'gamma', 'editor');
    assert.ok((await getSettings(editor.ctx)).slug.length > 0);
    await assert.rejects(() => updateSettings(editor.ctx, { city: 'Jeddah' }), (e: any) => code(e) === 'forbidden');
    const b = await store(harness, 'beta');
    assert.equal((await getSettings(b.ctx)).crNumber, null);
  } finally { await harness.close(); }
});
