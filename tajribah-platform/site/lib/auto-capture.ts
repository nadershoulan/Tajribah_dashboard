/**
 * T135 — auto capture, as Tangiblee's («ثابت…», then «التقاط الصورة…»): once the detector has found the hand (or face)
 * and it has stayed still for a moment, the photo is taken by itself; then it waits for the hand to go away, or for a
 * new pose (moved or turned well away from the last photo's), before it may take another — so one pose gives one photo,
 * however long it is held. Pure: sightings in, a decision out.
 */

export type Sample = { t: number; x: number; y: number; width: number };
export type AutoState = { history: Sample[]; since: number | null; armed: boolean; last: number; gone: number | null; shot: { x: number; y: number; width: number } | null };
export type AutoStep = { state: AutoState; progress: number; fire: boolean };

/** How long the hand must stay still, and how still (a share of the screen's width). */
export const HOLD_MS = 1200;
export const STILL = 0.035;
/** A new pose: moved this far from the last photo's (a share of the screen's width), or its size changed by a fifth. */
export const NEW_POSE = 0.12;
const WINDOW_MS = 500;
/** The hand away this long after a shot — not a dropped frame — and the next pose may be taken. */
export const AWAY_MS = 600;

export const startAuto = (): AutoState => ({ history: [], since: null, armed: true, last: -Infinity, gone: null, shot: null });

/**
 * One look: `seen` where the product would go now (screen pixels) when the detector says ready, else null; `screen` the
 * screen's width. `progress` 0…1 fills the ring round the shutter; `fire` takes the photo.
 */
export function stepAuto(s: AutoState, now: number, seen: { x: number; y: number; width: number } | null, screen: number): AutoStep {
  // after a shot: the hand away for a moment (not one dropped frame), or a new pose, and it may shoot again
  if (!seen) {
    const gone = s.gone ?? now;
    return { state: { ...s, history: [], since: null, armed: s.armed || now - gone >= AWAY_MS, gone }, progress: 0, fire: false };
  }
  const moved = !!s.shot && (Math.hypot(seen.x - s.shot.x, seen.y - s.shot.y) > NEW_POSE * screen || Math.abs(seen.width - s.shot.width) > s.shot.width * 0.2);
  const armed = s.armed || moved;
  const history = [...s.history.filter((p) => now - p.t <= WINDOW_MS), { t: now, ...seen }];
  const still = history.every((p) => Math.hypot(p.x - seen.x, p.y - seen.y) <= STILL * screen && Math.abs(p.width - seen.width) <= seen.width * 0.08);
  if (!still || !armed) return { state: { ...s, history, since: null, armed, gone: null }, progress: 0, fire: false };
  const since = s.since ?? now;
  const progress = Math.min(1, (now - since) / HOLD_MS);
  if (progress < 1) return { state: { ...s, history, since, armed, gone: null }, progress, fire: false };
  return { state: { history: [], since: null, armed: false, last: now, gone: null, shot: { x: seen.x, y: seen.y, width: seen.width } }, progress: 1, fire: true };
}
