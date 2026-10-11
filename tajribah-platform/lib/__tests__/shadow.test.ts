/**
 * T134.1 — the shadows a product casts: a tight dark contact shadow and a wide faint ambient one, falling down and a
 * little away; each kind its own; in proportion to how big the product is drawn.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cssShadow, featherRadius, shadowLayers, softEdged, type ShadowKind } from '@site/lib/shadow';

const KINDS: ShadowKind[] = ['watch', 'eyewear', 'ring', 'necklace', 'bag', 'earring', 'flat'];

test('every kind: a contact shadow tighter and darker than its ambient one, both falling down and away', () => {
  for (const kind of KINDS) {
    const [contact, ambient] = shadowLayers(kind, 300);
    assert.ok(contact && ambient, kind);
    assert.ok(contact.blur < ambient.blur, `${kind}: contact is tighter`);
    assert.ok(contact.alpha > ambient.alpha, `${kind}: contact is darker`);
    assert.ok(contact.offsetY < ambient.offsetY, `${kind}: contact sits closer`);
    for (const l of [contact, ambient]) {
      assert.ok(l.offsetY > 0, `${kind}: the light is above — shadows fall down`);
      assert.ok(l.offsetX >= 0 && l.offsetX < l.offsetY, `${kind}: a little to the side, mostly down`);
      assert.ok(l.alpha > 0 && l.alpha <= 0.5, `${kind}: never a black blot`);
    }
  }
});

test('in proportion to the product drawn: twice as wide, twice the blur and offset; a tiny product still casts one', () => {
  const small = shadowLayers('watch', 150), big = shadowLayers('watch', 300);
  assert.ok(Math.abs(big[1]!.blur - 2 * small[1]!.blur) < 0.01);
  assert.ok(Math.abs(big[1]!.offsetY - 2 * small[1]!.offsetY) < 0.01);
  assert.equal(big[0]!.alpha, small[0]!.alpha, 'darkness does not change with size');
  const tiny = shadowLayers('ring', 4);
  assert.ok(tiny.every((l) => l.blur >= 1 && l.offsetY >= 1), 'at least a pixel');
});

test('each kind as it is worn: glasses throw a faint shadow, a bag a long one, a ring hugs its finger', () => {
  const at = (k: ShadowKind) => shadowLayers(k, 300);
  assert.ok(at('eyewear')[0]!.alpha < at('watch')[0]!.alpha, 'glasses: faint on the face');
  assert.ok(at('bag')[1]!.offsetY > at('watch')[1]!.offsetY, 'a bag: a longer shadow');
  assert.ok(at('ring')[0]!.alpha >= at('watch')[0]!.alpha, 'a ring: dark where it touches');
});

test('T134.3 — the same two shadows as a CSS filter for the phone page: the canvas’s numbers, contact first', () => {
  const css = cssShadow('watch', 200);
  const [contact, ambient] = shadowLayers('watch', 200);
  assert.equal(css, `drop-shadow(${contact!.offsetX.toFixed(1)}px ${contact!.offsetY.toFixed(1)}px ${contact!.blur.toFixed(1)}px rgba(16, 22, 28, 0.5)) drop-shadow(${ambient!.offsetX.toFixed(1)}px ${ambient!.offsetY.toFixed(1)}px ${ambient!.blur.toFixed(1)}px rgba(16, 22, 28, 0.28))`);
  assert.match(cssShadow('bag', 400), /^drop-shadow\([\d.]+px [\d.]+px [\d.]+px rgba\(16, 22, 28, 0\.3\)\) drop-shadow\(/);
});

test('the edge blend: about a pixel of the picture — more for a product drawn big, never none, never a blur', () => {
  assert.ok(Math.abs(featherRadius(300) - 1.05) < 1e-9);
  assert.ok(featherRadius(600) > featherRadius(300), 'in proportion');
  assert.equal(featherRadius(20), 0.6, 'a tiny product still softened');
  assert.equal(featherRadius(5000), 2, 'a huge one at most 2 px — an edge, not a blur');
});

test('the edge blend: worked at the picture’s own size (the inside as sharp as before), inward from its blurred outline, kept while resized', () => {
  type Call = [string, ...unknown[]];
  const made: { w: number; h: number; calls: Call[] }[] = [];
  class FakeCanvas {
    calls: Call[] = [];
    constructor(public w: number, public h: number) { made.push(this); }
    getContext() {
      const calls = this.calls;
      return new Proxy({}, {
        set: (_t, k, v) => { calls.push(['set', k, v]); return true; },
        get: (_t, k) => (...args: unknown[]) => { calls.push([String(k), ...args]); },
      });
    }
  }
  const before = (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas;
  (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = FakeCanvas;
  try {
    const watch = { naturalWidth: 1000, naturalHeight: 400 } as unknown as CanvasImageSource;
    const soft = softEdged(watch, 300) as unknown as FakeCanvas;
    assert.equal(made.length, 2, 'the product and its mask');
    const [out, mask] = made as [FakeCanvas, FakeCanvas];
    assert.equal(soft, out);
    assert.deepEqual([out.w, out.h], [1000, 400], 'at the picture’s own size — not the size it is seen at (a second resample blurred the dial)');
    assert.deepEqual(out.calls[0], ['drawImage', watch, 0, 0, 1000, 400]);
    // 1.05 px seen at 300 wide = 3.5 px of a 1000 px picture; the canvas blur is twice the spread
    assert.ok(mask.calls.some((c) => c[0] === 'set' && c[1] === 'shadowBlur' && c[2] === 7), 'the outline blurred by the radius, in the picture’s pixels');
    assert.equal(mask.calls.filter((c) => c[0] === 'drawImage' && c[1] === out).length, 2, 'twice: the inside stays whole');
    const inward = out.calls.findIndex((c) => c[0] === 'set' && c[1] === 'globalCompositeOperation' && c[2] === 'destination-in');
    assert.ok(inward > 0 && out.calls.slice(inward).some((c) => c[0] === 'drawImage' && c[1] === mask), 'only ever takes away: nothing grows past the outline');
    assert.equal(softEdged(watch, 300), soft, 'dragged or turned: the same one');
    assert.equal(softEdged(watch, 330), soft, 'resized: the same radius in the picture’s pixels — nothing new');
    assert.equal(made.length, 2);
    softEdged(watch, 100);
    assert.equal(made.length, 4, 'drawn tiny (the radius at its floor): made again');
    const huge = { naturalWidth: 4096, naturalHeight: 1024 } as unknown as CanvasImageSource;
    softEdged(huge, 300);
    assert.deepEqual([made[4]!.w, made[4]!.h], [2048, 512], 'a huge picture worked at 2048 at most');
    const unloaded = { naturalWidth: 0, naturalHeight: 0 } as unknown as CanvasImageSource;
    assert.equal(softEdged(unloaded, 300), unloaded, 'not loaded yet: as it is');
  } finally {
    (globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas = before;
  }
});
