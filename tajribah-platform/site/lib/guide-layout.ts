/**
 * T135 — where each kind's camera guide sits, as Tangiblee's does (Nader's recording, 2026-10-11): the arm lying
 * across the screen with the hand at one side for a watch or a ring, the arm hanging for a bag, the face for glasses
 * and a necklace, the head in profile for an earring — and where the product's own picture goes on it, translucent.
 *
 * Pure numbers on the guide's drawing (100 wide, 178 tall — a phone's screen; the drawing in millimetres, placed by
 * `origin`, `angle` and `scale`). The side (`left`: the shopper's left wrist, or left ear) mirrors the drawing; the
 * product is never mirrored (its picture would read backwards), only moved and turned to the other side.
 */
import type { PairKind } from './pair-product';
import type { Pose, Pt } from './placement';

export type Side = 'left' | 'right';
export const VIEW = { W: 100, H: 178 } as const;

/**
 * The drawing's frame: where its origin lands, how it is turned (degrees) and scaled (drawing units per millimetre),
 * and whether it is mirrored. The drawings are made for the right side (the right wrist, fingers to the left; the
 * left ear for an earring is the mirrored one).
 */
export type Layout = { origin: Pt; angle: number; scale: number; mirrored: boolean };

export const BASE_LAYOUT: Record<PairKind, Omit<Layout, 'mirrored'>> = {
  watch: { origin: { x: 64, y: 92 }, angle: 12, scale: 0.42 }, // the wrist crease; the arm runs to the right, a little down
  ring: { origin: { x: 74, y: 124 }, angle: 35, scale: 0.46 }, // the hand up to the left, so the ring finger stays in view
  bag: { origin: { x: 40, y: 62 }, angle: -4, scale: 0.24 }, // the wrist; the arm hangs from the top, the hand below
  glasses: { origin: { x: 50, y: 80 }, angle: 0, scale: 0.42 }, // between the eyes
  necklace: { origin: { x: 50, y: 74 }, angle: 0, scale: 0.36 }, // the chin
  earring: { origin: { x: 50, y: 104 }, angle: 0, scale: 0.75 }, // the earlobe, close up (the face model cannot see an ear)
};

/** Which kinds have a side to choose: the hand for a watch, a ring and a bag; the ear for an earring. */
export const HAS_SIDE: Record<PairKind, boolean> = { watch: true, ring: true, bag: true, earring: true, glasses: false, necklace: false };

/** The right side is drawn; the left is its mirror (an earring is drawn for the right ear too). */
export function layoutOf(kind: PairKind, side: Side): Layout {
  return { ...BASE_LAYOUT[kind], mirrored: HAS_SIDE[kind] && side === 'left' };
}

/** A point of the drawing (millimetres) on the guide (drawing units). */
export function toGuide(l: Layout, p: Pt): Pt {
  const r = (l.angle * Math.PI) / 180;
  const x = l.origin.x + (Math.cos(r) * p.x - Math.sin(r) * p.y) * l.scale;
  const y = l.origin.y + (Math.sin(r) * p.x + Math.cos(r) * p.y) * l.scale;
  return l.mirrored ? { x: VIEW.W - x, y } : { x, y };
}

/** The product on the guide: where its picture goes, how wide (guide units) and turned (degrees), never mirrored. */
export function guideProduct(kind: PairKind, side: Side, caseMm: number, aspect: number): Pose {
  const l = layoutOf(kind, side);
  const width = caseMm * l.scale;
  const height = width * aspect;
  const turn = (deg: number) => (l.mirrored ? -deg : deg);
  switch (kind) {
    case 'watch': {
      // its case's near edge 10 mm up the arm from the crease (site/lib/placement.ts), the strap across the arm
      const c = toGuide(l, { x: 10 + caseMm / 2, y: 0 });
      return { x: c.x, y: c.y, width, angle: turn(l.angle) };
    }
    case 'ring': {
      // on the ring finger, 40 % of the way from its base knuckle to the next joint; the band across the finger
      const c = toGuide(l, RING_SPOT);
      return { x: c.x, y: c.y, width, angle: turn(l.angle + RING_FINGER_ANGLE + 90) };
    }
    case 'bag': {
      // hanging straight down from the grip (the middle finger, curled)
      const grip = toGuide(l, { x: 0, y: 118 });
      return { x: grip.x, y: grip.y + height / 2, width, angle: 0 };
    }
    case 'necklace':
      return { x: l.origin.x, y: l.origin.y + 9.6 * l.scale + height / 2, width, angle: 0 };
    case 'earring': {
      // hanging from the piercing, 15 % of the ear (60 mm) above the lobe's bottom — site/lib/placement.ts's rule
      const pierce = toGuide(l, { x: 0, y: -9 });
      return { x: pierce.x, y: pierce.y + height / 2, width, angle: 0 };
    }
    default: // glasses: centred a touch below the eyes
      return { x: l.origin.x, y: l.origin.y + 1.5 * l.scale, width, angle: 0 };
  }
}

/** The ring finger in the ring's drawing: its base knuckle, its direction (degrees, 180 = to the left), the ring's place. */
export const RING_FINGER_ANGLE = 186;
export const RING_SPOT: Pt = { x: -100 - 22 * Math.cos(((RING_FINGER_ANGLE - 180) * Math.PI) / 180), y: -18 - 22 * Math.sin(((RING_FINGER_ANGLE - 180) * Math.PI) / 180) };
