/**
 * T134.4 — what the camera guide tells the shopper while it looks: nothing found yet, come closer, show a little more
 * (the wrist, the fingers, the whole face), or ready. Pure: the points the detector found on the frame (in the frame's
 * own pixels) in, a state out — the page turns it into a short sentence for the product's kind.
 */
import { KNUCKLE_SPAN_MM, handScale, placeOnHand, type FacePoints, type HandKind, type HandPoints, type Pt } from './placement';

export type Feedback = 'none' | 'far' | 'edge' | 'ready';
export type Frame = { width: number; height: number };

/** A hand this small (its knuckle span against the frame's shorter side) is too far away to measure well. */
export const FAR_HAND = 0.12;
/** Pupils this close together (against the frame's width) — a face too far away. */
export const FAR_FACE = 0.09;
/** How far inside the frame's edges the parts that matter must be (a share of the shorter side). */
export const EDGE = 0.04;

const inside = (p: Pt, f: Frame, margin: number) => p.x >= margin && p.y >= margin && p.x <= f.width - margin && p.y <= f.height - margin;

/**
 * A hand: none; far (the knuckles too close together on the picture); edge (where the product goes is cut off — the
 * watch's place on the forearm, the ring finger's joints, the grip); ready.
 */
export function handFeedback(kind: HandKind, h: HandPoints | null, frame: Frame): Feedback {
  if (!h) return 'none';
  const short = Math.min(frame.width, frame.height);
  // the knuckle span the hand would have seen flat (the larger of its two measures — an angle only shortens one)
  if (handScale(h) * KNUCKLE_SPAN_MM < short * FAR_HAND) return 'far';
  const margin = short * EDGE;
  const needed: Pt[] = kind === 'ring'
    ? [h.ringMcp, h.ringPip, h.indexMcp, h.pinkyMcp]
    : kind === 'bag'
      ? [h.wrist, h.middleMcp, h.middlePip]
      : (() => { const w = placeOnHand('watch', h, 38, 1); return [h.wrist, h.middleMcp, { x: w.x, y: w.y }]; })();
  return needed.every((p) => inside(p, frame, margin)) ? 'ready' : 'edge';
}

/** A face: none; far (the pupils too close together); edge (the chin or an eye cut off); ready. */
export function faceFeedback(f: FacePoints | null, frame: Frame): Feedback {
  if (!f) return 'none';
  const ipd = Math.hypot(f.rightPupil.x - f.leftPupil.x, f.rightPupil.y - f.leftPupil.y);
  if (ipd < frame.width * FAR_FACE) return 'far';
  const margin = Math.min(frame.width, frame.height) * EDGE;
  return [f.leftPupil, f.rightPupil, f.chin].every((p) => inside(p, frame, margin)) ? 'ready' : 'edge';
}

/**
 * T138 — a sighting missed for a moment (one look in a dozen a second finds nothing — a blur, a finger over the
 * wrist) is not the hand gone: for this long the product stays where it was and the guide keeps what it said, instead
 * of blinking off and flashing «أظهر يدك».
 */
export const DROP_MS = 250;

/**
 * T138 — how the drawn product follows the sightings: the "one-euro" filter. Each sighting moves it part of the way,
 * and how far depends on how fast the hand moves — held still, only a small part (the detector's own jitter of a few
 * pixels is smoothed away); moving, nearly all the way (no trailing behind). A fixed share (`follow`, before) had to
 * choose between jittering when still and lagging when moving. Speed is measured in the product's own widths a second,
 * so it behaves the same near or far (from where it is and its size — the angle the detector reads is the noisiest).
 */
export const MIN_CUTOFF = 0.25;
export const BETA = 0.5;
const SPEED_CUTOFF = 1;
export type Smoothing<T> = { at: number; pose: T; speed: number } | null;
const share = (cutoff: number, dt: number) => 1 / (1 + 1 / (2 * Math.PI * cutoff * dt));

export function smooth<T extends { x: number; y: number; width: number; angle: number }>(was: Smoothing<T>, next: T, now: number): { state: Smoothing<T>; pose: T } {
  // the first sighting, or after a gap: straight there
  if (!was || now - was.at > 500 || now <= was.at) return { state: { at: now, pose: next, speed: 0 }, pose: next };
  const dt = (now - was.at) / 1000, p = was.pose, w = Math.max(1, p.width);
  const turn = ((next.angle - p.angle + 540) % 360) - 180;
  const raw = Math.max(Math.hypot(next.x - p.x, next.y - p.y), Math.abs(next.width - p.width)) / w / dt;
  const speed = was.speed + share(SPEED_CUTOFF, dt) * (raw - was.speed);
  const k = share(MIN_CUTOFF + BETA * speed, dt);
  const pose = { ...next, x: p.x + (next.x - p.x) * k, y: p.y + (next.y - p.y) * k, width: p.width + (next.width - p.width) * k, angle: p.angle + turn * k };
  return { state: { at: now, pose, speed }, pose };
}

/**
 * Follow a moving target smoothly: each new sighting moves the drawn pose part of the way (`k`), the angle the short
 * way round — so the product glides with the hand instead of jittering on every frame. (The live camera uses `smooth`
 * since T138; this stays for a single fixed step.)
 */
export function follow<T extends { x: number; y: number; width: number; angle: number }>(was: T | null, next: T, k = 0.45): T {
  if (!was) return next;
  const turn = ((next.angle - was.angle + 540) % 360) - 180;
  return { ...next, x: was.x + (next.x - was.x) * k, y: was.y + (next.y - was.y) * k, width: was.width + (next.width - was.width) * k, angle: was.angle + turn * k };
}
