/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T140.5 — real success numbers from the try-on's anonymous events: found by itself (of the photos it had to place),
 * moved by hand, and moved although found; by kind, by source, by look; only the try-on's own events, only the period.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyticsEvents } from '@/db/schema';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import { summarize, tryOnAccuracy } from '@/server/modules/admin/accuracy';

setLogLevel('error');

test('the numbers: found of those it had to place (a photo from the phone apart), moved, moved although found', () => {
  const a = summarize([
    { kind: 'watch', source: 'camera', found: 'detected', how: 'as-is', moved: 'no', n: 6 },
    { kind: 'watch', source: 'camera', found: 'detected', how: 'shrunk', moved: 'yes', n: 2 },
    { kind: 'watch', source: 'upload', found: 'none', how: '', moved: 'yes', n: 2 },
    { kind: 'glasses', source: 'camera', found: 'guide', how: '', moved: 'no', n: 0 },
    { kind: 'watch', source: 'phone', found: 'phone', how: '', moved: 'no', n: 5 },
  ], 3, 30, '2026-09-12T00:00:00.000Z');
  assert.equal(a.photos, 15);
  assert.deepEqual(a.found, { detected: 8, phone: 5, guide: 0, none: 2 });
  assert.equal(a.foundPct, 80, '8 of the 10 it had to place itself — the 5 fitted on the phone are apart');
  assert.equal(a.movedPct, 26.7, '4 of 15');
  assert.equal(a.movedWhenFoundPct, 25, '2 of the 8 found still moved');
  assert.deepEqual(a.kinds[0], { name: 'watch', photos: 15, foundPct: 80, movedPct: 26.7 });
  assert.deepEqual(a.sources.map((s) => [s.name, s.photos, s.foundPct]), [['camera', 8, 100], ['phone', 5, null], ['upload', 2, 0]]);
  assert.deepEqual(a.looks, [{ how: 'as-is', n: 6 }, { how: 'shrunk', n: 2 }]);
  assert.equal(a.shares, 3);
  const none = summarize([], 0, 7, 'x');
  assert.deepEqual([none.photos, none.foundPct, none.movedPct, none.movedWhenFoundPct], [0, null, null, null], 'nothing yet: no made-up percentages');
});

test('from the database: only the try-on’s own events, only within the period, every store together', async () => {
  const harness = await createTestDb();
  try {
    const a = await seedTenant(harness, 'alpha');
    const b = await seedTenant(harness, 'bravo');
    const now = new Date('2026-10-12T12:00:00Z');
    const recent = new Date(now.getTime() - 2 * 86_400_000), old = new Date(now.getTime() - 40 * 86_400_000);
    const photo = (tenantId: string, found: string, moved: string, occurredAt: Date, surface = 'tryon') =>
      ({ tenantId, eventType: 'tryon_capture', sessionId: 's', occurredAt, properties: { surface, kind: 'watch', source: 'camera', found, ...(found === 'detected' ? { how: 'as-is' } : {}), moved } });
    await harness.asAdmin(() => harness.db.insert(analyticsEvents).values([
      photo(a.tenantId, 'detected', 'no', recent), photo(a.tenantId, 'detected', 'yes', recent), photo(b.tenantId, 'none', 'yes', recent),
      photo(a.tenantId, 'detected', 'no', old), // outside the period
      photo(a.tenantId, 'detected', 'no', recent, 'page'), // not the try-on's own
      { tenantId: a.tenantId, eventType: 'tryon_share', sessionId: 's', occurredAt: recent, properties: { surface: 'tryon', how: 'shared', from: 'studio' } },
      { tenantId: a.tenantId, eventType: 'tryon_start', sessionId: 's', occurredAt: recent }, // the widget's: not a photo
    ] as any));
    const r = await tryOnAccuracy(30, now);
    assert.equal(r.photos, 3);
    assert.equal(r.foundPct, 66.7);
    assert.equal(r.movedWhenFoundPct, 50);
    assert.equal(r.shares, 1);
    assert.equal((await tryOnAccuracy(1, now)).photos, 0, 'a day: none that recent');
  } finally { await harness.close(); }
});
