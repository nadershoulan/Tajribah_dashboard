/**
 * T135 — the camera guide as Tangiblee's: each kind drawn where it goes, the other side its mirror, and the product's own
 * picture put where the engine would put it — moved and turned to the other side, never mirrored.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HAS_SIDE, VIEW, guideProduct, layoutOf, toGuide } from '@site/lib/guide-layout';
import { ringPlacement, watchPlacement, type HandPoints } from '@site/lib/placement';
import type { PairKind } from '@site/lib/pair-product';

const KINDS: PairKind[] = ['watch', 'ring', 'bag', 'glasses', 'necklace', 'earring'];
const near = (a: number, b: number, tol: number, what: string) => assert.ok(Math.abs(a - b) <= tol, `${what}: ${a} vs ${b}`);

test('the left side is the right side’s mirror; faces have no side', () => {
  for (const kind of KINDS) {
    const r = layoutOf(kind, 'right'), l = layoutOf(kind, 'left');
    assert.equal(r.mirrored, false);
    assert.equal(l.mirrored, HAS_SIDE[kind], kind);
    const p = { x: 30, y: -12 };
    const a = toGuide(r, p), b = toGuide(l, p);
    if (HAS_SIDE[kind]) { near(b.x, VIEW.W - a.x, 1e-9, `${kind} mirrored x`); near(b.y, a.y, 1e-9, `${kind} same height`); }
    else assert.deepEqual(a, b, `${kind}: one face`);
  }
});

test('the product on the guide: inside the screen, its real size on the drawing’s scale, never mirrored — moved and turned', () => {
  for (const kind of KINDS) for (const side of ['left', 'right'] as const) {
    const g = guideProduct(kind, side, 30, 1.2);
    assert.ok(g.x > 0 && g.x < VIEW.W && g.y > 0 && g.y < VIEW.H, `${kind} ${side} on the screen: ${g.x}, ${g.y}`);
    near(g.width, 30 * layoutOf(kind, side).scale, 1e-9, `${kind} at its real size on the drawing`);
  }
  const r = guideProduct('watch', 'right', 30, 1), l = guideProduct('watch', 'left', 30, 1);
  near(l.x, VIEW.W - r.x, 1e-9, 'across the screen'); near(l.angle, -r.angle, 1e-9, 'turned the other way'); near(l.width, r.width, 1e-9, 'the same size');
});

test('where the engine would put it: a watch up the arm from the crease, the dial upright; a ring across its finger', () => {
  // the right wrist drawn: fingers to the left, the arm to the right — the watch to the crease's right, upright with the arm
  const l = layoutOf('watch', 'right');
  const crease = toGuide(l, { x: 0, y: 0 }), g = guideProduct('watch', 'right', 30, 1);
  assert.ok(g.x > crease.x, 'up the arm, not on the hand');
  near(g.angle, l.angle, 1e-9, 'the strap across the arm');
  // the engine on the same drawn hand (thumb towards the shopper, below): the same angle
  const at = (x: number, y: number) => toGuide(l, { x, y });
  const hand: HandPoints = { wrist: at(0, 0), middleMcp: at(-100, 0), middlePip: at(-130, 0), indexMcp: at(-96, 17), pinkyMcp: at(-95, -34), ringMcp: at(-100, -17), ringPip: at(-128, -17) };
  near(watchPlacement(hand, 30).angle, g.angle, 0.5, 'the engine agrees on the dial’s turn');
  const ring = guideProduct('ring', 'right', 20, 1);
  const rl = layoutOf('ring', 'right');
  const knuckle = toGuide(rl, { x: -100, y: -18 }), joint = toGuide(rl, { x: -100 - 50 * Math.cos((6 * Math.PI) / 180), y: -18 - 50 * Math.sin((6 * Math.PI) / 180) });
  const fingers: HandPoints = { ...hand, ringMcp: knuckle, ringPip: joint, indexMcp: toGuide(rl, { x: -98, y: 18 }), pinkyMcp: toGuide(rl, { x: -96, y: -36 }) };
  near(((ringPlacement(fingers, 20).angle - ring.angle + 540) % 360) - 180, 0, 1, 'the band across the finger, as the engine turns it');
});

test('an earring hangs from the piercing, 15 % of the ear above the lobe’s bottom', () => {
  const l = layoutOf('earring', 'right');
  const lobe = toGuide(l, { x: 0, y: 0 });
  const g = guideProduct('earring', 'right', 10, 1.5);
  near(g.y - (g.width * 1.5) / 2, lobe.y - 9 * l.scale, 1e-9, 'its top at the piercing');
});
