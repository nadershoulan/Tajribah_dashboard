/**
 * T140.5 — the try-on's anonymous counts: one event per photo (found by itself or not, moved by hand or not), one per
 * share; the collector's own schema accepts them; nothing is sent when the browser declines tracking.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movedFrom, photoEvent, sendTryOn, shareEvent, tryonBatch } from '@site/lib/tryon-telemetry';
import { parseBatch } from '@/lib/contracts/analytics';

const at = { x: 500, y: 400, width: 100, angle: 10 };

test('moved by hand: a real correction — not a nudge', () => {
  assert.equal(movedFrom(at, at), false);
  assert.equal(movedFrom(at, { ...at, x: 504 }), false, '4 px of a 100 px product: a nudge');
  assert.equal(movedFrom(at, { ...at, x: 520 }), true, 'a fifth of its width');
  assert.equal(movedFrom(at, { ...at, angle: 13 }), false);
  assert.equal(movedFrom(at, { ...at, angle: 20 }), true, 'turned 10°');
  assert.equal(movedFrom({ ...at, angle: 178 }, { ...at, angle: -179 }), false, 'the short way round: 3°');
  assert.equal(movedFrom(at, { ...at, width: 104 }), false);
  assert.equal(movedFrom(at, { ...at, width: 112 }), true, 'resized');
  assert.equal(movedFrom(at, at, 1.1), true, 'or resized with the size slider');
  assert.equal(movedFrom(null, at), false);
});

test('the events: what happened to a photo and to a share — nothing else; the collector accepts the batch', () => {
  const photo = photoEvent({ kind: 'watch', source: 'camera', found: 'detected', how: 'shrunk', moved: false });
  assert.deepEqual(photo.properties, { surface: 'tryon', kind: 'watch', source: 'camera', found: 'detected', how: 'shrunk', moved: 'no' });
  assert.equal(photo.type, 'tryon_capture');
  assert.deepEqual(photoEvent({ kind: 'ring', source: 'upload', found: 'none', moved: true }).properties, { surface: 'tryon', kind: 'ring', source: 'upload', found: 'none', moved: 'yes' }, 'no how when none');
  const share = shareEvent('shared', 'studio');
  assert.equal(share.type, 'tryon_share');
  const batch = tryonBatch('failet', '244167095', [photo, share], 'a'.repeat(22), 1_791_800_000_000);
  const parsed = parseBatch(batch);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.reason);
  assert.deepEqual(batch.events.map((e) => e.productId), ['244167095', '244167095']);
  assert.equal(JSON.stringify(batch).includes('data:'), false, 'no picture');
});

test('nothing is sent when the browser declines tracking, or with nowhere to count', () => {
  const sent: string[] = [];
  const g = globalThis as Record<string, unknown>;
  const before = { navigator: Object.getOwnPropertyDescriptor(g, 'navigator'), window: g.window, sessionStorage: g.sessionStorage };
  const nav = (dnt: string | null) => ({ doNotTrack: dnt, sendBeacon: (_: string, b: Blob) => { void b.text().then((t) => sent.push(t)); return true; } });
  try {
    Object.defineProperty(g, 'window', { value: {}, configurable: true, writable: true });
    Object.defineProperty(g, 'sessionStorage', { value: { getItem: () => null, setItem: () => {} }, configurable: true, writable: true });
    Object.defineProperty(g, 'navigator', { value: nav('1'), configurable: true });
    sendTryOn({ store: 'failet', product: 'p1' }, [shareEvent('saved', 'camera')]);
    Object.defineProperty(g, 'navigator', { value: nav(null), configurable: true });
    sendTryOn(null, [shareEvent('saved', 'camera')]);
    sendTryOn({ store: '', product: 'p1' }, [shareEvent('saved', 'camera')]);
    assert.equal(sent.length, 0);
    sendTryOn({ store: 'failet', product: 'p1' }, [shareEvent('saved', 'camera')]);
    return new Promise<void>((resolve) => setTimeout(() => { assert.equal(sent.length, 1, 'allowed: one beacon'); assert.ok(sent[0]!.includes('"tryon_share"')); resolve(); }, 20));
  } finally {
    setTimeout(() => {
      if (before.navigator) Object.defineProperty(g, 'navigator', before.navigator);
      g.window = before.window; g.sessionStorage = before.sessionStorage;
    }, 30);
  }
});
