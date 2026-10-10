/**
 * T134.1 — the shadows a product casts: a tight dark contact shadow and a wide faint ambient one, falling down and a
 * little away; each kind its own; in proportion to how big the product is drawn.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shadowLayers, type ShadowKind } from '@site/lib/shadow';

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
