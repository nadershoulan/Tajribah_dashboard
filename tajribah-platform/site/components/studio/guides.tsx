'use client';

/**
 * T134.4 — the guide drawn over the camera (and on the studio's «عليّ» before a photo): where to put the hand or the
 * face for this kind of product, and where the product will go. A watch: the back of the hand, fingers up, the forearm
 * running off the bottom, the band across the wrist marked. A ring: an open hand, fingers apart, the ring finger
 * marked. A bag: the arm down at the side, the grip marked. Glasses: a face, the eyes marked. A necklace: the face, the
 * neck and the shoulders. An earring: the head turned a little, the ear's lobe marked.
 *
 * A hand is drawn as fingers, palm and forearm filled in one piece and outlined by an SVG filter (grow the shape, keep
 * only what grew), so the outline goes round the whole hand, with no lines where the parts meet.
 */
import type { PairKind } from '@site/lib/pair-product';
import type { Feedback } from '@site/lib/live-feedback';

export type GuideState = Feedback | 'idle';

type Finger = [x1: number, y1: number, x2: number, y2: number, width: number];
type HandShape = { arm: string; palm: string; fingers: Finger[]; thumb: string; thumbWidth: number };

const WATCH: HandShape = {
  arm: 'M35,182 L65,182 L62.5,118 L37.5,118 Z',
  palm: 'M37.5,121 C35,108 31.5,96 31,80 C31,74 34,71 38,71 L62,71 C66,71 69,74 69,80 C68.5,96 65,108 62.5,121 Z',
  fingers: [[36.5, 76, 34, 44, 8.6], [46, 74, 45.5, 36, 8.8], [55, 75, 57, 40, 8.4], [63.5, 78, 67, 53, 7.4]],
  thumb: 'M35,104 L25,90 L21,81', thumbWidth: 9.6,
};
const RING: HandShape = {
  arm: 'M38,182 L62,182 L60.5,140 L39.5,140 Z',
  palm: 'M39.5,143 C36,128 30,112 30,96 C30,89 34,86 39,86 L61,86 C67,86 71,90 70.5,97 C70,112 65,128 60.5,143 Z',
  fingers: [[37, 90, 27, 56, 8.8], [46.5, 88, 45, 46, 9], [56, 89, 61, 50, 8.6], [64.5, 93, 75, 66, 7.6]],
  thumb: 'M33,118 L19,102 L13,92', thumbWidth: 9.8,
};
const BAG: HandShape = {
  arm: 'M36,-4 L64,-4 L62,93 L38,93 Z',
  palm: 'M38,90 C36,102 35,112 36,125 L64,125 C65,112 64,102 62,90 Z',
  fingers: [[40.5, 122, 41, 142, 8.4], [47.5, 124, 47.5, 146, 8.6], [54.5, 124, 54, 145, 8.4], [61, 121, 60, 138, 7.4]],
  thumb: 'M37,100 L31,116', thumbWidth: 9,
};

function Hand({ shape, id, outline }: { shape: HandShape; id: string; outline: number }) {
  return (
    <>
      <defs>
        <filter id={id} x="-20%" y="-20%" width="140%" height="140%">
          <feMorphology in="SourceAlpha" operator="dilate" radius={outline} result="grown" />
          <feComposite in="grown" in2="SourceAlpha" operator="out" result="ring" />
          <feFlood floodColor="currentColor" />
          <feComposite in2="ring" operator="in" />
        </filter>
      </defs>
      <g className="guide-body">
        <HandParts shape={shape} />
      </g>
      <g filter={`url(#${id})`}>
        <HandParts shape={shape} />
      </g>
    </>
  );
}

function HandParts({ shape }: { shape: HandShape }) {
  return (
    <g fill="#fff" stroke="#fff" strokeLinecap="round" strokeLinejoin="round">
      <path d={shape.arm} strokeWidth="0" />
      <path d={shape.palm} strokeWidth="0" />
      {shape.fingers.map(([x1, y1, x2, y2, w], i) => <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={w} />)}
      <path d={shape.thumb} fill="none" strokeWidth={shape.thumbWidth} />
    </g>
  );
}

/** The drawing for each kind; `mark` is where the product will go. */
function Drawing({ kind, id, outline }: { kind: PairKind; id: string; outline: number }) {
  switch (kind) {
    case 'ring':
      return (
        <>
          <Hand shape={RING} id={id} outline={outline} />
          <rect className="guide-mark" x="-6.5" y="-2.2" width="13" height="4.4" rx="1.8" transform="translate(57.5 77.3) rotate(7.3)" />
        </>
      );
    case 'bag':
      return (
        <>
          <Hand shape={BAG} id={id} outline={outline} />
          <rect className="guide-mark" x="35" y="131" width="31" height="9" rx="3" />
        </>
      );
    case 'glasses':
      return (
        <g className="guide-line">
          <ellipse cx="50" cy="74" rx="27" ry="35" />
          <path d="M40,107 L40,126 M60,107 L60,126" />
          <rect className="guide-mark" x="30.5" y="63" width="17.5" height="10" rx="3.5" />
          <rect className="guide-mark" x="52" y="63" width="17.5" height="10" rx="3.5" />
          <path className="guide-mark" d="M48,67 L52,67" />
        </g>
      );
    case 'necklace':
      return (
        <g className="guide-line">
          <ellipse cx="50" cy="48" rx="20" ry="26" />
          <path d="M42,71 L42,86 C42,92 30,94 16,98 C8,100 4,106 3,118 M58,71 L58,86 C58,92 70,94 84,98 C92,100 96,106 97,118" />
          <path className="guide-mark" d="M41,88 C43,104 57,104 59,88" />
          <circle className="guide-mark" cx="50" cy="103.5" r="2" />
        </g>
      );
    case 'earring':
      return (
        <g className="guide-line">
          <ellipse cx="47" cy="72" rx="26" ry="34" />
          <path d="M71,60 C78,58 80,69 77,78 C75,84 72,87 70,85" />
          <path d="M37,104 L37,126 M57,104 L59,126" />
          <circle className="guide-mark" cx="71.5" cy="88" r="3.2" />
        </g>
      );
    default:
      return (
        <>
          <Hand shape={WATCH} id={id} outline={outline} />
          <rect className="guide-mark" x="35" y="126" width="30" height="14" rx="3.2" />
        </>
      );
  }
}

/**
 * The guide for `kind`, in the state the live detection is in (`idle`: no detection, e.g. before a photo). `outline`:
 * the hand's line in drawing units (100 across) — thicker when the guide is drawn small.
 */
export function Guide({ kind, state = 'idle', className = '', outline = 0.7 }: { kind: PairKind; state?: GuideState; className?: string; outline?: number }) {
  return (
    <svg className={`guide guide-${state} ${className}`} viewBox="0 0 100 178" preserveAspectRatio="xMidYMid meet" aria-hidden focusable="false" data-guide={kind}>
      <Drawing kind={kind} id={`guide-outline-${kind}-${String(outline).replace('.', '_')}`} outline={outline} />
    </svg>
  );
}

type T = (ar: string, en: string) => string;

/** The guide's sentence for the kind and the detection's state. */
export function guideText(kind: PairKind, state: GuideState, t: T): string {
  const hand = kind === 'watch' || kind === 'ring' || kind === 'bag';
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
  // none / idle: what to do
  switch (kind) {
    case 'ring': return t('افرد يدك وأظهر أصابعك داخل الإطار', 'Open your hand, fingers apart, inside the outline');
    case 'bag': return t('أنزل ذراعك وأظهر يدك داخل الإطار', 'Let your arm hang and keep your hand in the outline');
    case 'glasses': return t('ضع وجهك داخل الإطار وانظر إلى الكاميرا', 'Put your face in the outline and look at the camera');
    case 'necklace': return t('أظهر وجهك وأعلى صدرك داخل الإطار', 'Show your face and upper chest in the outline');
    case 'earring': return t('أدر رأسك قليلًا لتظهر أذنك', 'Turn your head a little to show your ear');
    default: return hand ? t('ضع ظهر يدك ومعصمك داخل الإطار', 'Put the back of your hand and wrist in the outline') : '';
  }
}
