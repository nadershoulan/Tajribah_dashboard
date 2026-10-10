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
 * Follow a moving target smoothly: each new sighting moves the drawn pose part of the way (`k`), the angle the short
 * way round — so the product glides with the hand instead of jittering on every frame.
 */
export function follow<T extends { x: number; y: number; width: number; angle: number }>(was: T | null, next: T, k = 0.45): T {
  if (!was) return next;
  const turn = ((next.angle - was.angle + 540) % 360) - 180;
  return { ...next, x: was.x + (next.x - was.x) * k, y: was.y + (next.y - was.y) * k, width: was.width + (next.width - was.width) * k, angle: was.angle + turn * k };
}
