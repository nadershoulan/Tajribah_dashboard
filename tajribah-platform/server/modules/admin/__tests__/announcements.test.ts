/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * A13 — announcements (T23): both languages, a window of at most 90 days, links inside the
 * dashboard; every store sees a notice only while it is live; the app role can read, never write.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { appDb } from '@/db/client';
import { staffAudit } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import type { StaffContext } from '@/server/modules/admin/access';
import { createAnnouncement, listAnnouncements, liveAnnouncements, updateAnnouncement, type AnnouncementFields } from '@/server/modules/admin/announcements';

setLogLevel('error');
const STAFF = (id: string): StaffContext => ({ userId: id, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'r' });
const BASE: AnnouncementFields = {
  titleAr: 'صيانة مجدولة', titleEn: 'Scheduled maintenance', bodyAr: 'قد تتأخر المزامنة ساعة.', bodyEn: 'Syncing may be delayed for an hour.',
  level: 'warning', link: '/dashboard/connections', startsAt: '2026-10-01T00:00:00Z', endsAt: '2026-10-02T00:00:00Z', active: true,
};

test('publish: both languages, a window of at most 90 days, a dashboard link; live only inside its window; changes audited', async () => {
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    const staff = STAFF(store.userId);
    const invalid = (fields: Partial<AnnouncementFields>) => assert.rejects(() => createAnnouncement(staff, { ...BASE, ...fields, reason: 'invalid input test' }), (e: any) => e.code === 'validation_failed');
    await invalid({ titleAr: ' ' });
    await invalid({ titleEn: '' });
    await invalid({ bodyEn: null }); // Arabic body without English
    await invalid({ link: 'https://evil.example/phish' });
    await invalid({ link: '/admin' });
    await invalid({ endsAt: '2026-09-30T00:00:00Z' });
    await invalid({ endsAt: '2027-01-15T00:00:00Z' }); // more than 90 days
    await assert.rejects(() => createAnnouncement(staff, { ...BASE, reason: 'no' }), (e: any) => e.code === 'validation_failed', 'a reason');

    const made = await createAnnouncement(staff, { ...BASE, reason: 'maintenance window agreed with ops' }, new Date('2026-09-27T00:00:00Z'));
    assert.equal(made.live, false, 'not yet');
    assert.deepEqual(await liveAnnouncements(new Date('2026-09-30T23:59:59Z')), []);
    const live = await liveAnnouncements(new Date('2026-10-01T12:00:00Z'));
    assert.deepEqual(live.map((a) => [a.title.ar, a.title.en, a.level, a.link]), [['صيانة مجدولة', 'Scheduled maintenance', 'warning', '/dashboard/connections']]);
    assert.deepEqual(await liveAnnouncements(new Date('2026-10-02T00:00:00Z')), [], 'the end is exclusive');

    await updateAnnouncement(staff, made.id, { active: false, reason: 'maintenance cancelled' });
    assert.deepEqual(await liveAnnouncements(new Date('2026-10-01T12:00:00Z')), [], 'switched off at once');
    await assert.rejects(() => updateAnnouncement(staff, made.id, { active: false, reason: 'already off here' }), (e: any) => e.code === 'conflict');
    await assert.rejects(() => updateAnnouncement(staff, made.id, { endsAt: '2026-09-01T00:00:00Z', reason: 'end before start' }), (e: any) => e.code === 'validation_failed');
    await assert.rejects(() => updateAnnouncement(staff, uuidv7(), { active: true, reason: 'no such notice' }), (e: any) => e.code === 'not_found');
    assert.equal((await listAnnouncements()).length, 1);
    const trail = await harness.asAdmin(() => harness.db.select().from(staffAudit));
    assert.deepEqual(trail.map((r) => [r.action, r.reason]), [['announcement.create', 'maintenance window agreed with ops'], ['announcement.update', 'maintenance cancelled']]);
  } finally { await harness.close(); }
});

test('the app role reads announcements and cannot write them', async () => {
  const harness = await createTestDb();
  try {
    const store = await seedTenant(harness, 'alpha');
    await createAnnouncement(STAFF(store.userId), { ...BASE, reason: 'role test notice' });
    const denied = (e: any) => { for (let x = e; x; x = x.cause) if (/permission denied/.test(String(x.message))) return true; return false; };
    await assert.rejects(() => appDb().execute(sql`update announcements set title_en = 'Hacked'`), denied);
    await assert.rejects(() => appDb().execute(sql`delete from announcements`), denied);
    const rows: any = await appDb().execute(sql`select title_en from announcements`);
    assert.equal((Array.isArray(rows) ? rows : rows.rows).length, 1, 'but it can read them');
  } finally { await harness.close(); }
});
