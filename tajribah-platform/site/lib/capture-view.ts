/**
 * T134.3 — the phone page's picture maths, pure: how a camera frame or a photo fills the screen (edge to edge, like the
 * phone's own camera — or whole, when the product would fall outside the part shown), where a pose on the photo lands
 * on the screen, and what a drag or a pinch does to the pose.
 */
import type { Pose, Pt } from './placement';

export type Size = { width: number; height: number };
/** A picture drawn at `scale`, its top-left corner at (ox, oy) on the screen — the shape `handPoints` takes. */
export type Fit = { scale: number; ox: number; oy: number };

/** Filling the screen (`cover`, cut at two edges) or shown whole (`contain`, bars at two edges). */
export function fitOf(screen: Size, picture: Size, mode: 'cover' | 'contain'): Fit {
  const sx = screen.width / picture.width, sy = screen.height / picture.height;
  const scale = mode === 'cover' ? Math.max(sx, sy) : Math.min(sx, sy);
  return { scale, ox: (screen.width - picture.width * scale) / 2, oy: (screen.height - picture.height * scale) / 2 };
}

/** Edge to edge, unless that would cut off where the product is (`at`, on the picture) — then the whole picture. */
export function fillFor(screen: Size, picture: Size, at: Pt | null, margin = 0.06): 'cover' | 'contain' {
  if (!at) return 'cover';
  const cover = fitOf(screen, picture, 'cover');
  const x = cover.ox + at.x * cover.scale, y = cover.oy + at.y * cover.scale;
  const mx = screen.width * margin, my = screen.height * margin;
  return x >= mx && x <= screen.width - mx && y >= my && y <= screen.height - my ? 'cover' : 'contain';
}

/** A pose on the picture (its pixels) as it lands on the screen. */
export const onScreen = (p: Pose, fit: Fit): Pose => ({ x: fit.ox + p.x * fit.scale, y: fit.oy + p.y * fit.scale, width: p.width * fit.scale, angle: p.angle });

/** A point on the screen as a point on the picture. */
export const onPicture = (p: Pt, fit: Fit): Pt => ({ x: (p.x - fit.ox) / fit.scale, y: (p.y - fit.oy) / fit.scale });

/** One finger moved the product by (dx, dy) screen pixels. */
export const dragged = (start: Pose, dx: number, dy: number, fit: Fit): Pose => ({ ...start, x: start.x + dx / fit.scale, y: start.y + dy / fit.scale });

/**
 * Two fingers: the product grows and turns as the line between them does (from `a0`–`b0` to `a1`–`b1`), and moves with
 * their middle; between 8 picture pixels and `maxWidth` wide.
 */
export function pinched(start: Pose, a0: Pt, b0: Pt, a1: Pt, b1: Pt, fit: Fit, maxWidth: number): Pose {
  const d0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1, d1 = Math.hypot(b1.x - a1.x, b1.y - a1.y);
  const turn = ((Math.atan2(b1.y - a1.y, b1.x - a1.x) - Math.atan2(b0.y - a0.y, b0.x - a0.x)) * 180) / Math.PI;
  const mid0 = { x: (a0.x + b0.x) / 2, y: (a0.y + b0.y) / 2 }, mid1 = { x: (a1.x + b1.x) / 2, y: (a1.y + b1.y) / 2 };
  return {
    x: start.x + (mid1.x - mid0.x) / fit.scale,
    y: start.y + (mid1.y - mid0.y) / fit.scale,
    width: Math.min(maxWidth, Math.max(8, start.width * (d1 / d0))),
    angle: start.angle + turn,
  };
}

/** Landmarks found on a frame shown mirrored (the front camera, like a mirror) as they are on the mirrored picture. */
export const mirrored = <T extends { x: number }>(points: T[]): T[] => points.map((p) => ({ ...p, x: 1 - p.x }));

/**
 * The photo slid up just enough that the product (`pose`, where it first landed — so it never jumps while dragged) ends
 * above `limitY` on the screen: the buttons along the bottom must not cover it. Never slid down.
 */
export function liftedAbove(fit: Fit, pose: Pose | null, aspect: number, limitY: number): Fit {
  if (!pose) return fit;
  const bottom = fit.oy + (pose.y + (pose.width * aspect) / 2) * fit.scale;
  return bottom > limitY ? { ...fit, oy: fit.oy - (bottom - limitY) } : fit;
}
