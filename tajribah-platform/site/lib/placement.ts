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
 * **Where.** A watch sits just above the wrist bone: its case's near edge about 10 mm up the forearm from where the
 * hand begins (landmark 0, which MediaPipe puts on the wrist crease), so a bigger case reaches further up the arm —
 * T134.3; before, every case's centre went 0.28 of a palm up, which left a small watch far from the hand on a phone
 * photo and put a big one almost on it. The strap runs across the arm: the forearm runs from the middle knuckle back
 * through the wrist.
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
/** The gap between where the hand begins (the wrist crease) and the near edge of a watch's case, in millimetres. */
export const WATCH_GAP_MM = 10;
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
  const back = (WATCH_GAP_MM + caseMm / 2) * pxPerMm; // the case's near edge just above the wrist bone
  // The picture's strap runs up and down; across the arm means turned with the forearm. Which way up: a watch is worn
  // with 12 o'clock towards the little finger's side (palm down, it faces away from the wearer) — so a right wrist,
  // or a hand seen from the other side, turns it round (T135: before, a right wrist's dial came out upside down).
  const along = Math.atan2(h.middleMcp.y - h.wrist.y, h.middleMcp.x - h.wrist.x);
  const up = { x: Math.sin(along), y: -Math.cos(along) }; // the picture's top at that turn
  const flip = up.x * (h.pinkyMcp.x - h.indexMcp.x) + up.y * (h.pinkyMcp.y - h.indexMcp.y) < 0;
  const degrees = (along * 180) / Math.PI + (flip ? 180 : 0);
  return {
    x: h.wrist.x + (fx / len) * back,
    y: h.wrist.y + (fy / len) * back,
    width: Math.max(1, caseMm * pxPerMm),
    angle: degrees > 180 ? degrees - 360 : degrees,
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

/**
 * T134.3 — the other kinds, the studio's own rules (T68, T83, T84) moved here so the phone page places them the same
 * way. `aspect`: the product picture's height over its width (a necklace, an earring and a bag hang from their top
 * edge, so their centre is half a height lower).
 */

/**
 * Glasses from the two pupils: an adult's are about 62 mm apart; centred a touch below them, tilted as the eyes. Two
 * taps come in either order (taken left to right); `ordered` (a detector's points): `a` is the eye on the picture's
 * left when the face is upright — so a face turned sideways or upside down gets its glasses turned the same way.
 */
export const PUPIL_DISTANCE_MM = 62;
export function glassesPlacement(a: Pt, b: Pt, frameMm: number, ordered = false): Pose {
  const [l, r] = ordered || a.x <= b.x ? [a, b] : [b, a];
  const ipd = dist(l, r);
  return {
    x: (l.x + r.x) / 2,
    y: (l.y + r.y) / 2 + ipd * 0.025,
    width: (frameMm * ipd) / PUPIL_DISTANCE_MM,
    angle: (Math.atan2(r.y - l.y, r.x - l.x) * 180) / Math.PI,
  };
}

/** A necklace from the chin and the pupils' distance: its chains start about 9.6 mm below the chin, hanging straight. */
export function necklacePlacement(chin: Pt, ipd: number, mm: number, aspect: number): Pose {
  const pxPerMm = ipd / PUPIL_DISTANCE_MM;
  const width = mm * pxPerMm;
  return { x: chin.x, y: chin.y + 9.6 * pxPerMm + (width * aspect) / 2, width, angle: 0 };
}

/**
 * An earring from two points: the top of the ear and the bottom of the lobe. The ear is taken as 60 mm long; the
 * piercing sits 15 % of the ear above the lobe's bottom, and the earring hangs straight down from it.
 */
export function earringPlacement(top: Pt, lobe: Pt, mm: number, aspect: number): Pose {
  const pxPerMm = dist(top, lobe) / 60;
  const pierce = { x: lobe.x + (top.x - lobe.x) * 0.15, y: lobe.y + (top.y - lobe.y) * 0.15 };
  const width = mm * pxPerMm;
  return { x: pierce.x, y: pierce.y + (width * aspect) / 2, width, angle: 0 };
}

/**
 * A bag in the hand: the hand as the ruler (as for a watch), hanging straight down, the top of its handles at the grip
 * (the middle finger between its base and middle joints).
 */
export function bagPlacement(h: HandPoints, mm: number, aspect: number, score = 1): Placement {
  const pxPerMm = handScale(h);
  const top = { x: (h.middleMcp.x + h.middlePip.x) / 2, y: (h.middleMcp.y + h.middlePip.y) / 2 };
  const width = Math.max(1, mm * pxPerMm);
  return { x: top.x, y: top.y + (width * aspect) / 2, width, angle: 0, confidence: confidenceOf(h, score) };
}

/**
 * The face points the placements use (MediaPipe face landmarks: iris centres 468 and 473, chin 152). `leftPupil` (468)
 * is on the picture's left when the face is upright and the picture not mirrored — checked on the demo's face photo.
 */
export type FacePoints = { leftPupil: Pt; rightPupil: Pt; chin: Pt };

export function facePoints(landmarks: { x: number; y: number }[], img: { width: number; height: number }, fit: { scale: number; ox: number; oy: number }): FacePoints | null {
  if (!landmarks || !landmarks[468] || !landmarks[473] || !landmarks[152]) return null;
  const at = (i: number): Pt => ({ x: landmarks[i]!.x * img.width * fit.scale + fit.ox, y: landmarks[i]!.y * img.height * fit.scale + fit.oy });
  return { leftPupil: at(468), rightPupil: at(473), chin: at(152) };
}

export type HandKind = 'watch' | 'ring' | 'bag';
export type FaceKind = 'glasses' | 'necklace';

/** One call for a hand kind: where the product goes on this hand. */
export function placeOnHand(kind: HandKind, h: HandPoints, mm: number, aspect: number, score = 1): Placement {
  return kind === 'ring' ? ringPlacement(h, mm, score) : kind === 'bag' ? bagPlacement(h, mm, aspect, score) : watchPlacement(h, mm, score);
}

/**
 * One call for a face kind (an earring needs the ear, which the face model does not find: two taps instead).
 * `mirrored`: the points were flipped like the front camera's picture — the eyes then swap sides.
 */
export function placeOnFace(kind: FaceKind, f: FacePoints, mm: number, aspect: number, mirrored = false): Pose {
  if (kind === 'necklace') return necklacePlacement(f.chin, dist(f.leftPupil, f.rightPupil), mm, aspect);
  return mirrored ? glassesPlacement(f.rightPupil, f.leftPupil, mm, true) : glassesPlacement(f.leftPupil, f.rightPupil, mm, true);
}

/**
 * T140.4 — an earring placed by itself (Nader: "earrings placed automatically — they needed two taps"). The face model
 * does not mark the ear, but it does mark the face's outline: on a photo of the face from the front or a little
 * turned, the earlobe hangs just outside that outline, about where the outline passes from the ear's middle down to the
 * lobe (MediaPipe's face-oval points 323 → 361 on one side, 93 → 132 on the other) — measured on our real face photos,
 * where the ears are hidden by hair, it lands under the hair where the lobe is. The ear nearer the camera is used (the
 * outline farther from the nose), never one cut off by the photo's edge; the size from the pupils (62 mm apart); the
 * earring hangs straight down.
 *
 * A side photo (no face found from the front): Google's pose model marks the ear itself (7, 8); the piercing is taken
 * about 19 mm below the ear's middle, the size from the pupils or, turned away, from the ear to the eye's outer corner
 * (about 75 mm). Neither found: the two taps, as before.
 */
export const EAR_SIDES: readonly [number, number][] = [[323, 361], [93, 132]];
/** How far outside the face's outline the lobe hangs. */
export const LOBE_OUTSIDE_MM = 4;
/** From the ear's middle (the pose model's ear point) down to the piercing; from the ear to the eye's outer corner. */
export const PIERCE_BELOW_EAR_MM = 19;
export const EAR_EYE_MM = 75;

type Mark = { x: number; y: number; visibility?: number };
type Drawn = { width: number; height: number };
type Fit = { scale: number; ox: number; oy: number };
const onStage = (lm: Mark[], img: Drawn, fit: Fit) => (i: number): Pt => ({ x: lm[i]!.x * img.width * fit.scale + fit.ox, y: lm[i]!.y * img.height * fit.scale + fit.oy });
const insidePhoto = (p: Pt, img: Drawn, fit: Fit) => p.x >= fit.ox && p.x <= fit.ox + img.width * fit.scale && p.y >= fit.oy && p.y <= fit.oy + img.height * fit.scale;

/** An earring from the face model's points (a face from the front or a little turned); null when it cannot say. */
export function earringFromFace(lm: Mark[], img: Drawn, fit: Fit, mm: number, aspect: number): Pose | null {
  if (!lm || !lm[468] || !lm[473] || !lm[1] || EAR_SIDES.some(([a, b]) => !lm[a] || !lm[b])) return null;
  const at = onStage(lm, img, fit);
  const l = at(468), r = at(473), nose = at(1);
  const ipd = dist(l, r);
  if (!(ipd > 0)) return null;
  const s = ipd / PUPIL_DISTANCE_MM;
  const u = { x: (r.x - l.x) / ipd, y: (r.y - l.y) / ipd }; // along the eyes
  const lobes = EAR_SIDES.map(([a, b]) => {
    const p = { x: (at(a).x + at(b).x) / 2, y: (at(a).y + at(b).y) / 2 };
    const out = Math.sign((p.x - nose.x) * u.x + (p.y - nose.y) * u.y) || 1; // away from the nose, along the eyes
    return { x: p.x + out * u.x * LOBE_OUTSIDE_MM * s, y: p.y + out * u.y * LOBE_OUTSIDE_MM * s };
  }).filter((p) => insidePhoto(p, img, fit)).sort((p, q) => dist(q, nose) - dist(p, nose));
  const pierce = lobes[0];
  if (!pierce) return null;
  const width = mm * s;
  return { x: pierce.x, y: pierce.y + (width * aspect) / 2, width, angle: 0 };
}

/** An earring from the pose model's points (a side photo): the ear itself; null when no ear is seen. */
export function earringFromPose(lm: Mark[], img: Drawn, fit: Fit, mm: number, aspect: number): Pose | null {
  if (!lm || lm.length < 9) return null;
  const at = onStage(lm, img, fit);
  const seen = (i: number) => (lm[i]?.visibility ?? 1) > 0.5;
  const nose = at(0);
  const ears = [7, 8].filter((i) => seen(i) && insidePhoto(at(i), img, fit)).sort((a, b) => dist(at(b), nose) - dist(at(a), nose));
  const ear = ears[0];
  if (ear === undefined) return null;
  const e = at(ear), corner = at(ear === 7 ? 3 : 6);
  const bothEyes = seen(2) && seen(5);
  const eyes = bothEyes ? dist(at(2), at(5)) : 0;
  const s = Math.max(eyes / PUPIL_DISTANCE_MM, dist(e, corner) / EAR_EYE_MM);
  if (!(s > 0)) return null;
  // down the head: across the eyes' line when both are seen (pointing down the picture), else the picture's down
  let down = { x: 0, y: 1 };
  if (bothEyes && eyes > 0) {
    const ux = (at(2).x - at(5).x) / eyes, uy = (at(2).y - at(5).y) / eyes;
    down = ux >= 0 ? { x: -uy, y: ux } : { x: uy, y: -ux }; // the perpendicular that points down the picture
  }
  const width = mm * s;
  return { x: e.x + down.x * PIERCE_BELOW_EAR_MM * s, y: e.y + down.y * PIERCE_BELOW_EAR_MM * s + (width * aspect) / 2, width, angle: 0 };
}
