/**
 * T134.5 — where a product goes on the shopper's own photo, from the landmarks a detector finds (MediaPipe's hand and
 * face models, run on the shopper's device). Pure: points in, a pose out — so it is tested with hands drawn from
 * measurements, and the studio and the phone page use the same rules.
 *
 * **True size.** A photo has no ruler, so the hand is the ruler: an adult's index and little fingers' base knuckles
 * are about 58 mm apart (between a woman's ~55 and a man's ~62 — tried on the demo's real wrist photo, 62 drew a
 * woman's watch too small), and the wrist to the middle finger's base knuckle about 100 mm. A hand seen at an angle looks
 * shorter one way, never longer, so the scale is the larger of the two. A watch is then drawn at its real case width,
 * the same rule as the ring (T68) and the bag (T84) — before, a watch took 90 % of the palm's width whatever its size.
 *
 * **Where.** A watch sits just above the wrist bone, about 0.28 of a palm up the forearm from where the hand begins
 * (landmark 0; a fifth sat it against the hand on the real photo),
 * its strap across the arm: the forearm runs from the middle knuckle back through the wrist.
 *
 * **When the detector finds nothing**, the studio tries the photo turned a quarter, a half and three quarters (a phone
 * photo is often sideways) — `unrotate` brings those landmarks back to the photo as it is shown.
 */

export type Pt = { x: number; y: number };
export type Pose = { x: number; y: number; width: number; angle: number };

/** The hand points the placements use, in the stage's pixels (MediaPipe's indices in the comments). */
export type HandPoints = {
  wrist: Pt; // 0
  indexMcp: Pt; // 5
  middleMcp: Pt; // 9
  middlePip: Pt; // 10
  ringMcp: Pt; // 13
  ringPip: Pt; // 14
  pinkyMcp: Pt; // 17
};

/** Adult averages (anthropometric): base knuckles index → little, and wrist → middle base knuckle. */
export const KNUCKLE_SPAN_MM = 58;
export const PALM_LENGTH_MM = 100;
/** How far up the forearm a watch sits from where the hand begins, as a share of the palm's length. */
export const WATCH_BACK = 0.28;
/** A hand whose knuckle span is smaller than this many stage pixels is too far away to place on with confidence. */
export const MIN_SPAN_PX = 28;

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Pixels per millimetre on this hand: the larger of the two adult measures (foreshortening only ever shrinks one). */
export function handScale(h: HandPoints): number {
  return Math.max(dist(h.indexMcp, h.pinkyMcp) / KNUCKLE_SPAN_MM, dist(h.wrist, h.middleMcp) / PALM_LENGTH_MM);
}

/** The hand points from MediaPipe's 21 normalised landmarks on a photo drawn at `fit` (scale, offset) on the stage. */
export function handPoints(landmarks: { x: number; y: number }[], img: { width: number; height: number }, fit: { scale: number; ox: number; oy: number }): HandPoints | null {
  if (!landmarks || landmarks.length < 21) return null;
  const at = (i: number): Pt => ({ x: landmarks[i]!.x * img.width * fit.scale + fit.ox, y: landmarks[i]!.y * img.height * fit.scale + fit.oy });
  return { wrist: at(0), indexMcp: at(5), middleMcp: at(9), middlePip: at(10), ringMcp: at(13), ringPip: at(14), pinkyMcp: at(17) };
}

export type Placement = Pose & {
  /** 0…1 — how sure the placement is: the detector's own score, lowered for a hand too small to measure. */
  confidence: number;
};

/** How sure to be: the detector's score, scaled down when the hand is small in the picture. */
function confidenceOf(h: HandPoints, score: number): number {
  const span = dist(h.indexMcp, h.pinkyMcp);
  const size = Math.min(1, span / (MIN_SPAN_PX * 2));
  return Math.max(0, Math.min(1, score)) * size;
}

/**
 * A watch on the wrist, at its real size. `caseMm`: its case width; the try-on's watch picture is as wide as its case
 * (T75: cropped to the case's edges), so the drawn width is the case width in pixels.
 */
export function watchPlacement(h: HandPoints, caseMm: number, score = 1): Placement {
  const pxPerMm = handScale(h);
  // the forearm's direction: from the middle knuckle back through the wrist
  const fx = h.wrist.x - h.middleMcp.x, fy = h.wrist.y - h.middleMcp.y;
  const len = Math.hypot(fx, fy) || 1;
  const back = PALM_LENGTH_MM * WATCH_BACK * pxPerMm; // just above the wrist bone, up the arm from where the hand begins
  return {
    x: h.wrist.x + (fx / len) * back,
    y: h.wrist.y + (fy / len) * back,
    width: Math.max(1, caseMm * pxPerMm),
    // the picture's strap runs up and down; across the arm means turned with the forearm
    angle: (Math.atan2(h.middleMcp.y - h.wrist.y, h.middleMcp.x - h.wrist.x) * 180) / Math.PI,
    confidence: confidenceOf(h, score),
  };
}

/** A ring on the ring finger, between its base and middle joints, across the finger, at its real width (T68's rule). */
export function ringPlacement(h: HandPoints, caseMm: number, score = 1): Placement {
  const pxPerMm = dist(h.indexMcp, h.pinkyMcp) / KNUCKLE_SPAN_MM;
  const dx = h.ringPip.x - h.ringMcp.x, dy = h.ringPip.y - h.ringMcp.y;
  return {
    x: h.ringMcp.x + dx * 0.4,
    y: h.ringMcp.y + dy * 0.4,
    width: Math.max(1, caseMm * pxPerMm),
    angle: (Math.atan2(dx, -dy) * 180) / Math.PI,
    confidence: confidenceOf(h, score),
  };
}

/** A point found on the photo turned `quarters` × 90° clockwise, back on the photo as it is (normalised 0…1). */
export function unrotate(p: Pt, quarters: number): Pt {
  switch (((quarters % 4) + 4) % 4) {
    case 1: return { x: p.y, y: 1 - p.x }; // the photo was turned 90° clockwise
    case 2: return { x: 1 - p.x, y: 1 - p.y };
    case 3: return { x: 1 - p.y, y: p.x };
    default: return p;
  }
}

/** Where a point of the photo lands once the photo is turned `quarters` × 90° clockwise (the inverse of `unrotate`). */
export function rotatePoint(p: Pt, quarters: number): Pt {
  return unrotate(p, 4 - (((quarters % 4) + 4) % 4));
}
