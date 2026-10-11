/**
 * T135 — auto capture: found and held still → the photo by itself; moving starts the wait again; after a shot, the hand
 * must go away (not one dropped frame) or a few seconds pass before the next.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AWAY_MS, HOLD_MS, NEW_POSE, STILL, startAuto, stepAuto, type AutoState } from '@site/lib/auto-capture';

const W = 390;
const run = (s: AutoState, from: number, to: number, seen: (t: number) => { x: number; y: number; width: number } | null) => {
  let state = s, fired: number[] = [], progress = 0;
  for (let t = from; t <= to; t += 80) { const step = stepAuto(state, t, seen(t), W); state = step.state; progress = step.progress; if (step.fire) fired.push(t); }
  return { state, fired, progress };
};
const still = () => ({ x: 200, y: 400, width: 60 });

test('held still: the ring fills, then the photo is taken once', () => {
  const half = run(startAuto(), 0, HOLD_MS / 2, still);
  assert.ok(half.progress > 0.3 && half.progress < 0.7, `half way: ${half.progress}`);
  assert.deepEqual(half.fired, []);
  const all = run(startAuto(), 0, HOLD_MS + 400, still);
  assert.equal(all.fired.length, 1, 'one photo');
});

test('moving more than a little starts the wait again; nothing found, nothing taken', () => {
  const shaky = run(startAuto(), 0, HOLD_MS * 3, (t) => ({ x: 200 + (Math.floor(t / 240) % 2) * STILL * W * 2, y: 400, width: 60 }));
  assert.deepEqual(shaky.fired, [], 'never still long enough');
  assert.deepEqual(run(startAuto(), 0, HOLD_MS * 3, () => null).fired, []);
});

test('after a shot: not again while the hand stays, however long — until it goes away, or takes a new pose', () => {
  const first = run(startAuto(), 0, HOLD_MS + 200, still);
  assert.equal(first.fired.length, 1);
  const t0 = first.fired[0]!;
  const staying = run(first.state, t0 + 80, t0 + 15000, still);
  assert.deepEqual(staying.fired, [], 'the same pose is not taken twice, even held for 15 seconds');
  const blink = run(first.state, t0 + 80, t0 + 2000, (t) => (t === t0 + 400 ? null : still()));
  assert.deepEqual(blink.fired, [], 'one dropped frame is not the hand going away');
  const away = run(first.state, t0 + 80, t0 + 80 + AWAY_MS + 80 + HOLD_MS + 400, (t) => (t < t0 + 80 + AWAY_MS + 80 ? null : still()));
  assert.equal(away.fired.length, 1, 'away and back: the next pose');
  const moved = run(first.state, t0 + 80, t0 + 600 + HOLD_MS + 600, (t) => (t < t0 + 600 ? still() : { ...still(), x: 200 + NEW_POSE * W * 1.5 }));
  assert.equal(moved.fired.length, 1, 'or a new pose: moved along the arm');
  const nudged = run(first.state, t0 + 80, t0 + 600 + HOLD_MS + 600, (t) => (t < t0 + 600 ? still() : { ...still(), x: 200 + NEW_POSE * W * 0.5 }));
  assert.deepEqual(nudged.fired, [], 'a nudge is the same pose');
});
