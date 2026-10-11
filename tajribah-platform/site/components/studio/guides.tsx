'use client';

/**
 * T134.4, T135 — the guide over the camera (and on the studio's «عليّ» before a photo): where to put the hand or the
 * face for this kind, drawn as Tangiblee's is (Nader's recording, 2026-10-11) — the arm lying across the screen with
 * the hand at one side for a watch or a ring, the arm hanging for a bag, the face for glasses and a necklace, the head
 * in profile for an earring — with **the product's own picture**, translucent and gently pulsing, where it will go
 * (never a drawn watch). The left / right switch flips the drawing with an animation; the product slides across.
 *
 * Drawings are in millimetres for the right side (`site/lib/guide-layout.ts` places, turns and scales them). A hand is
 * drawn as fingers, palm and forearm in one piece, outlined by an SVG filter (grow the shape, keep only what grew), so
 * the outline goes round the whole hand and the small gaps between the fingers read as lines.
 */
import type { PairKind } from '@site/lib/pair-product';
import type { Feedback } from '@site/lib/live-feedback';
import { BASE_LAYOUT, HAS_SIDE, RING_FINGER_ANGLE, VIEW, guideProduct, layoutOf, type Side } from '@site/lib/guide-layout';

export type GuideState = Feedback | 'idle';
export type GuideProduct = { src: string; caseMm: number; aspect: number };

type Finger = [x: number, y: number, angle: number, length: number, width: number];
const end = ([x, y, a, len]: Finger) => ({ x: x + len * Math.cos((a * Math.PI) / 180), y: y + len * Math.sin((a * Math.PI) / 180) });

/** A right wrist seen from above, palm down, fingers together to the left, thumb towards the shopper (below). */
const WATCH = {
  arm: 'M0,-27 L320,-42 L320,42 L0,27 Z',
  palm: 'M0,-27 C-28,-33 -70,-44 -98,-41 L-98,38 C-72,41 -30,33 0,27 Z',
  fingers: [[-95, -34, 181, 54, 14], [-97, -17, 180, 72, 16], [-97, 0, 180, 80, 17], [-96, 17, 179, 71, 16]] as Finger[],
  thumb: [-24, 30, 155, 44, 21] as Finger,
};
/** A right hand from above, fingers spread to the left: the ring finger second from the top. */
const RING = {
  arm: 'M0,-27 L200,-36 L200,36 L0,27 Z',
  palm: 'M0,-27 C-28,-34 -72,-46 -100,-44 L-100,40 C-72,43 -30,34 0,27 Z',
  fingers: [[-96, -36, 196, 56, 14], [-100, -18, RING_FINGER_ANGLE, 72, 16], [-100, 0, 179, 78, 17], [-98, 18, 171, 72, 16]] as Finger[],
  thumb: [-26, 30, 150, 50, 21] as Finger,
};
/** A right arm hanging at the side, the back of the hand to the camera, the fingers curled round a handle. */
const BAG = {
  arm: 'M-27,0 L-38,-330 L38,-330 L27,0 Z',
  palm: 'M-27,0 C-33,24 -40,62 -38,96 L40,96 C42,62 34,24 27,0 Z',
  fingers: [[-27, 92, 92, 34, 15], [-9, 94, 90, 38, 17], [9, 94, 90, 37, 17], [27, 92, 88, 32, 15]] as Finger[],
  thumb: [-30, 26, 112, 46, 20] as Finger,
};
type HandShape = typeof WATCH;

function Hand({ shape, id, radius }: { shape: HandShape; id: string; radius: number }) {
  const parts = (
    <g fill="#fff" stroke="#fff" strokeLinecap="round">
      <path d={shape.arm} strokeWidth="0" />
      <path d={shape.palm} strokeWidth="0" />
      {[...shape.fingers, shape.thumb].map((f, i) => { const e = end(f); return <line key={i} x1={f[0]} y1={f[1]} x2={e.x} y2={e.y} strokeWidth={f[4]} />; })}
    </g>
  );
  return (
    <>
      <defs>
        <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
          <feMorphology in="SourceAlpha" operator="dilate" radius={radius} result="grown" />
          <feComposite in="grown" in2="SourceAlpha" operator="out" result="ring" />
          <feFlood floodColor="currentColor" />
          <feComposite in2="ring" operator="in" />
        </filter>
      </defs>
      <g className="guide-body">{parts}</g>
      <g filter={`url(#${id})`}>{parts}</g>
    </>
  );
}

/** The drawing for each kind, in millimetres for the right side. */
function Drawing({ kind, id, radius }: { kind: PairKind; id: string; radius: number }) {
  switch (kind) {
    case 'ring': return <Hand shape={RING} id={id} radius={radius} />;
    case 'bag': return <Hand shape={BAG} id={id} radius={radius} />;
    case 'glasses':
      return (
        <g className="guide-line">
          <ellipse cx="0" cy="8" rx="72" ry="98" />
          <path d="M-72,-6 C-80,-8 -82,14 -74,24 M72,-6 C80,-8 82,14 74,24" />
          <path d="M-34,96 L-36,160 M34,96 L36,160" />
          <path d="M-40,0 Q-31,-6 -22,0 Q-31,5 -40,0 Z M22,0 Q31,-6 40,0 Q31,5 22,0 Z" />
        </g>
      );
    case 'necklace':
      return (
        <g className="guide-line">
          <ellipse cx="0" cy="-95" rx="68" ry="96" />
          <path d="M-30,-14 L-32,40 C-40,54 -90,60 -160,74 M30,-14 L32,40 C40,54 90,60 160,74" />
        </g>
      );
    case 'earring':
      // the right ear close up, the face to the right: the ear 60 mm from its top to the lobe's bottom (the origin)
      return (
        <g className="guide-line">
          <path d="M2,-60 C-20,-61 -31,-40 -27,-20 C-24,-7 -14,1 -3,2 C5,3 9,-3 8,-9 C7,-15 13,-19 12,-25 C11,-32 15,-44 13,-52 C11,-58 7,-60 2,-60 Z" />
          <path d="M-6,-50 C-19,-47 -21,-30 -12,-20 C-8,-16 -4,-17 -2,-21" />
          <path d="M40,-46 C46,-14 46,18 30,48 C22,62 12,72 4,78 M-28,6 C-32,30 -34,60 -36,96 M-60,-74 C-30,-86 20,-86 50,-70" />
        </g>
      );
    default: return <Hand shape={WATCH} id={id} radius={radius} />;
  }
}

/**
 * The guide for `kind`: `side` the shopper's left or right (hand, or ear for an earring); `state` the live detection's
 * (`idle`: none, e.g. before a photo); `product` its picture, put translucent where it will go. `outline`: the hand's
 * line in guide units (100 across) — thicker when the guide is drawn small.
 */
export function Guide({ kind, state = 'idle', side = 'left', product = null, className = '', outline = 0.7, fill = 'meet' }: {
  kind: PairKind; state?: GuideState; side?: Side; product?: GuideProduct | null; className?: string; outline?: number;
  /** `slice`: fill a wide box with the drawing's middle (the studio's small tile). */
  fill?: 'meet' | 'slice';
}) {
  const base = BASE_LAYOUT[kind];
  const flipped = layoutOf(kind, side).mirrored;
  const spot = guideProduct(kind, side, product?.caseMm ?? defaultMm(kind), product?.aspect ?? 1);
  const id = `guide-outline-${kind}-${String(outline).replace('.', '_')}`;
  return (
    <svg className={`guide guide-${state} ${className}`} viewBox={`0 0 ${VIEW.W} ${VIEW.H}`} preserveAspectRatio={`xMidYMid ${fill}`}
      aria-hidden focusable="false" data-guide={kind} data-side={HAS_SIDE[kind] ? side : undefined}>
      <g className="guide-in">
        <g className="guide-flip" style={{ transform: flipped ? 'scaleX(-1)' : 'scaleX(1)' }}>
          <g transform={`translate(${base.origin.x} ${base.origin.y}) rotate(${base.angle}) scale(${base.scale})`}>
            <Drawing kind={kind} id={id} radius={outline / base.scale} />
          </g>
        </g>
      </g>
      {/* the product itself (never mirrored — its picture would read backwards): moved and turned to the side */}
      <g className="guide-product" style={{ transform: `translate(${spot.x}px, ${spot.y}px) rotate(${spot.angle}deg)` }} data-spot={`${spot.x.toFixed(1)},${spot.y.toFixed(1)},${spot.width.toFixed(1)},${spot.angle.toFixed(1)}`}>
        {product
          ? <image href={product.src} x={-spot.width / 2} y={(-spot.width * product.aspect) / 2} width={spot.width} height={spot.width * product.aspect} preserveAspectRatio="xMidYMid meet" />
          : <rect className="guide-mark" x={-spot.width / 2} y={-spot.width / 2} width={spot.width} height={spot.width} rx={spot.width / 5} />}
      </g>
    </svg>
  );
}

/** A size to draw the mark at when there is no product (the demo's). */
function defaultMm(kind: PairKind): number {
  return { watch: 30, ring: 20, bag: 280, glasses: 132, necklace: 170, earring: 11 }[kind];
}

type T = (ar: string, en: string) => string;
export type CapturePhase = 'steady' | 'capturing' | null;

/** The guide's sentence: the capture's phase first, then what the detection sees, then what to do (auto or manual). */
export function guideText(kind: PairKind, state: GuideState, t: T, phase: CapturePhase = null, auto = true): string {
  if (phase === 'capturing') return t('جارٍ التقاط الصورة…', 'Taking the photo…');
  if (phase === 'steady') return kind === 'glasses' || kind === 'necklace' || kind === 'earring' ? t('اثبت قليلًا…', 'Hold still…') : t('ثبّت يدك…', 'Hold your hand still…');
  if (state === 'far') return t('اقترب قليلًا', 'Come a little closer');
  if (state === 'edge') {
    if (kind === 'watch') return t('أظهر معصمك وجزءًا من ساعدك', 'Show your wrist and part of your forearm');
    if (kind === 'ring') return t('أظهر أصابعك كاملة', 'Show all of your fingers');
    if (kind === 'bag') return t('أظهر يدك كاملة', 'Show your whole hand');
    return t('أظهر وجهك كاملًا', 'Show your whole face');
  }
  if (state === 'ready') {
    if (kind === 'watch') return t('تم تحديد المعصم — التقط الصورة', 'Wrist found — take the photo');
    if (kind === 'ring') return t('تم تحديد الإصبع — التقط الصورة', 'Finger found — take the photo');
    if (kind === 'bag') return t('تم تحديد اليد — التقط الصورة', 'Hand found — take the photo');
    return t('تم تحديد الوجه — التقط الصورة', 'Face found — take the photo');
  }
  // none / idle: what to do — with auto on, place it and hold; with auto off, take the photo
  switch (kind) {
    case 'ring': return auto ? t('افرد يدك وضعها داخل الإطار', 'Spread your fingers and place your hand in the outline') : t('افرد يدك والتقط صورة لها', 'Spread your fingers and take a photo of your hand');
    case 'bag': return auto ? t('أنزل ذراعك وضع يدك داخل الإطار', 'Let your arm hang and place your hand in the outline') : t('أنزل ذراعك والتقط صورة ليدك', 'Let your arm hang and take a photo of your hand');
    case 'glasses': return auto ? t('ضع وجهك داخل الإطار وانظر إلى الكاميرا', 'Put your face in the outline and look at the camera') : t('انظر إلى الكاميرا والتقط صورة لوجهك', 'Look at the camera and take a photo of your face');
    case 'necklace': return auto ? t('ضع وجهك وأعلى صدرك داخل الإطار', 'Put your face and upper chest in the outline') : t('التقط صورة لوجهك وأعلى صدرك', 'Take a photo of your face and upper chest');
    case 'earring': return auto ? t('أدر رأسك لتظهر أذنك داخل الإطار', 'Turn your head so your ear is in the outline') : t('أدر رأسك والتقط صورة لأذنك', 'Turn your head and take a photo of your ear');
    default: return auto ? t('شمّر كمّك وضع معصمك داخل الإطار', 'Roll up your sleeve and place your wrist in the outline') : t('شمّر كمّك والتقط صورة لمعصمك', 'Roll up your sleeve and take a photo of your wrist');
  }
}
