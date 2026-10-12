'use client';

/**
 * The phone camera try-on — T134.3, T135. Full screen, the store's (its name, its logo under white-label — never
 * Tajribah's), the product on the shopper's own hand or face. Learned from Tangiblee's (Nader's recording, 2026-10-11):
 *
 *  - the live camera with the kind's guide — the arm across the screen, the product's own picture translucent where it
 *    goes — and a left / right switch that flips it; the product follows the hand as it moves once it is found;
 *  - «تلقائي»: found and held still → «ثبّت يدك…» (a ring fills round the shutter) → «جارٍ التقاط الصورة…» → the photo
 *    is taken by itself and the camera stays for more; the banner offers manual mode; off, the shutter only;
 *  - the last photo's thumbnail with a count; the picture full screen with the product at its real size
 *    (`site/lib/placement.ts`) — or where the guide showed it, when no hand is found — moved with a finger, sized and
 *    turned with two; the hand's size; share or save; «أرسل إلى شاشتي» when it was opened from a computer's QR;
 *  - no camera (refused, or none): the phone's own camera and its photos.
 *
 * Used by the QR page (`/capture/[token]`) and by a product set to "on the phone only" (T135 D). Everything is looked
 * at on the phone; nothing leaves it unless the shopper sends or shares it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, Ear, Hand, ImagePlus, LoaderCircle, Monitor, RefreshCw, Ruler, Share2, SwitchCamera, X } from 'lucide-react';
import { preparePhoto } from '@site/lib/photo';
import { useLang } from '@site/lib/i18n';
import { useSiteEnv, SiteLink } from '@site/lib/site-env';
import { StoreMark } from '@site/components/site/store-mark';
import { Guide, guideText, type CapturePhase, type GuideState } from '@site/components/studio/guides';
import type { PairKind, PairProduct } from '@site/lib/pair-product';
import type { StoreBrand } from '@site/lib/tryon-config';
import { castShadow, cssShadow, softEdged, type ShadowKind } from '@site/lib/shadow';
import { NEUTRAL, lightOf, litProduct, litUrl, measureLight, tintOf, type Tint } from '@site/lib/light';
import { movedFrom, photoEvent, sendTryOn, shareEvent, type Found } from '@site/lib/tryon-telemetry';
import { useTelemetry } from '@site/components/tryon/telemetry';
import { detectHand } from '@site/lib/hand-detect';
import { detectFace } from '@site/lib/face-detect';
import { model } from '@site/lib/detectors';
import { earringPlacement, facePoints, handPoints, placeOnFace, placeOnHand, type Pose, type Pt } from '@site/lib/placement';
import { DROP_MS, faceFeedback, handFeedback, smooth, type Smoothing } from '@site/lib/live-feedback';
import { dragged, fillFor, fitOf, liftedAbove, mirrored, onPicture, onScreen, pinched, type Fit, type Size } from '@site/lib/capture-view';
import { HAS_SIDE, guideProduct, type Side } from '@site/lib/guide-layout';
import { startAuto, stepAuto, type AutoState } from '@site/lib/auto-capture';
import { dataUrlBlob, inviteText, sharePicture } from '@site/lib/share-picture';

type Landmark = { x: number; y: number; z?: number };
/** What the detector saw: its points (flipped with the picture when `mirrored`) and its score. */
type Sighting = { landmarks: Landmark[]; score: number; mirrored?: boolean };
/** Where the guide showed the product, on the frame that was taken (its pixels) — the shopper lined up with it. */
type GuideHint = { pose: Pose; frame: Size };
/**
 * `fill`: edge to edge, or the whole picture when that would cut off where the product is — chosen once, so it never
 * jumps mid-drag. `first`: where the product first landed — the photo is slid up from it so the buttons never cover it.
 */
export type Shot = { id: number; dataUrl: string; blob: Blob; size: Size; fill: 'cover' | 'contain'; pose: Pose | null; auto: Pose | null; first: Pose | null; taps: Pt[]; sent: boolean; /** T140.2: the product lit like this photo */ tint?: Tint; /** T140.5: for the anonymous counts */ source?: 'camera' | 'upload'; found?: Found; how?: string | null };
type View = 'camera' | 'pick' | 'result';
type HandSize = 'small' | 'medium' | 'large';

const loadImage = (src: string, cors = false) => new Promise<HTMLImageElement>((resolve, reject) => {
  const i = new Image(); if (cors) i.crossOrigin = 'anonymous';
  i.onload = () => resolve(i); i.onerror = () => reject(new Error('image')); i.src = src;
});
/** The same picture at a fresh address: a copy the browser kept from a plain request cannot be drawn and shared (T137). */
const fresh = (src: string) => src + (src.includes('?') ? '&' : '?') + 'cors=1';
const SHADOW: Record<PairKind, ShadowKind> = { watch: 'watch', ring: 'ring', bag: 'bag', glasses: 'eyewear', necklace: 'necklace', earring: 'earring' };
const MAX_SHOTS = 6;
/** Nothing found to measure by and no guide to go by: the product in the middle at about its usual share of the picture. */
const START_SHARE: Record<PairKind, number> = { watch: 0.22, ring: 0.1, bag: 0.5, glasses: 0.55, necklace: 0.45, earring: 0.08 };
/**
 * The ruler is an average adult's hand (or face, or ear); a smaller one is measured as fewer millimetres per pixel than it
 * is, so the product is drawn bigger — 58 mm knuckles against 52 and 64 mm (T135: Tangiblee's «تغيير حجم المعصم»).
 */
const HAND_SIZE: Record<HandSize, number> = { small: 58 / 52, medium: 1, large: 58 / 64 };

export type CameraTryOnProps = {
  product: PairProduct | null;
  brand: StoreBrand | null;
  kind: PairKind;
  /** «أرسل إلى شاشتي» — opened from a computer's QR; the photo and where the shopper left the product. */
  onSend?: (shot: Shot) => Promise<void>;
  /** In a shop's window (on the phone only, T135): its close button. */
  onClose?: () => void;
  /** T137: opened from the studio — «استخدم هذه الصورة» gives the photo and where the product was left back to it. */
  onUse?: (shot: Shot) => void;
  /** T137: where others can try the product — shared with the picture. */
  shareLink?: string | null;
};

export default function CameraTryOn({ product, brand, kind, onSend, onClose, onUse, shareLink = null }: CameraTryOnProps) {
  const { t, lang } = useLang(); // T137: no language switch on the camera (Nader) — it follows the shop's
  const { asset } = useSiteEnv();
  const onFace = kind === 'glasses' || kind === 'necklace' || kind === 'earring';
  const handKind = kind === 'ring' ? 'ring' : kind === 'bag' ? 'bag' : 'watch';
  const detects = kind !== 'earring'; // the face model cannot see an ear: an earring goes where the guide shows it
  const worn = product ? asset(product.worn) : '';

  const [view, setView] = useState<View>('camera');
  const [camera, setCamera] = useState<'starting' | 'live' | 'off'>('starting');
  const [facing, setFacing] = useState<'environment' | 'user'>(kind === 'glasses' || kind === 'necklace' ? 'user' : 'environment');
  const [state, setState] = useState<GuideState>('idle');
  const [side, setSide] = useState<Side>('left');
  const [auto, setAuto] = useState(detects);
  const [phase, setPhase] = useState<CapturePhase>(null);
  const [hold, setHold] = useState(0);
  const [flash, setFlash] = useState(0);
  const [shots, setShots] = useState<Shot[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [aspect, setAspect] = useState(1);
  const [screen, setScreen] = useState<Size>({ width: 390, height: 844 });
  const [handSize, setHandSize] = useState<HandSize>('medium');

  const main = useRef<HTMLElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const liveProduct = useRef<HTMLDivElement>(null);
  const nativeCamera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  /** The last sighting on the live frame: landmarks as on the (mirrored, when the front camera) picture. */
  const sighting = useRef<Sighting | null>(null);
  const autoOn = useRef(auto);
  const shoot = useRef<(fromAuto: boolean) => void>(() => {});
  const nextId = useRef(1);
  const mirror = facing === 'user';
  useEffect(() => { autoOn.current = auto; }, [auto]);

  const shot = shots.find((s) => s.id === current) ?? null;
  const guideFor = product ? { src: worn, caseMm: product.caseMm, aspect } : null;
  // T137: the pictures sharing draws, ready before the tap (a phone opens its share sheet only straight from the tap)
  const shareItem = useRef<HTMLImageElement | null>(null);
  const shotPicture = useRef<{ id: number; img: HTMLImageElement } | null>(null);
  useEffect(() => {
    if (!worn) return;
    let live = true;
    loadImage(worn, true).catch(() => loadImage(fresh(worn), true)).then((img) => { if (live) shareItem.current = img; }).catch(() => {});
    return () => { live = false; };
  }, [worn]);
  useEffect(() => {
    if (!shot) return;
    let live = true;
    const { id, dataUrl } = shot;
    loadImage(dataUrl).then((img) => { if (live) shotPicture.current = { id, img }; }).catch(() => {});
    return () => { live = false; };
  }, [shot?.id, shot?.dataUrl]); // eslint-disable-line react-hooks/exhaustive-deps

  // The product's proportions (a necklace, an earring and a bag hang from their top edge).
  useEffect(() => {
    if (!worn) return;
    let live = true;
    loadImage(worn).then((img) => { if (live && img.naturalWidth) setAspect(img.naturalHeight / img.naturalWidth); }).catch(() => {});
    return () => { live = false; };
  }, [worn]);

  useEffect(() => {
    const measure = () => setScreen({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  useEffect(() => { if (!note) return; const id = setTimeout(() => setNote(''), 5000); return () => clearTimeout(id); }, [note]);

  // ── The live camera ────────────────────────────────────────────────────────────────────────────────────────────
  const stopCamera = useCallback(() => {
    stream.current?.getTracks().forEach((track) => track.stop());
    stream.current = null;
  }, []);

  useEffect(() => {
    if (view !== 'camera') return;
    let cancelled = false;
    setCamera('starting'); setState('idle'); setPhase(null); setHold(0); sighting.current = null;
    (async () => {
      if (!navigator.mediaDevices?.getUserMedia) { setCamera('off'); setView('pick'); return; }
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } } });
        if (cancelled) { s.getTracks().forEach((track) => track.stop()); return; }
        stream.current = s;
        const v = video.current!;
        v.srcObject = s;
        await v.play();
        if (!cancelled) setCamera('live');
      } catch {
        if (!cancelled) { setCamera('off'); setView('pick'); }
      }
    })();
    return () => { cancelled = true; stopCamera(); };
  }, [view, facing, stopCamera]);

  // Look at the live frame a dozen times a second: the guide's state, the product following the hand or face, and —
  // with «تلقائي» on — whether it has been held still long enough to take the photo by itself.
  useEffect(() => {
    if (view !== 'camera' || camera !== 'live' || !detects) return;
    let stopped = false, frame = 0, last = 0, drawn: Pose | null = null, said: GuideState = 'idle', shown = 0;
    // T138: when the hand or face was last seen, and the drawn product's smoothing (steady when still, quick when moving)
    let seenAt = -Infinity, smoothing: Smoothing<Pose> = null, litAt = -Infinity, lightCanvas: HTMLCanvasElement | null = null;
    let steady: AutoState = startAuto();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let detector: any = null;
    (onFace ? model('face', 'VIDEO', asset) : model('hand', 'VIDEO', asset)).then((m) => { detector = m; }).catch(() => {});
    // a look that finds nothing just after a sighting is a dropped frame: the guide keeps what it said (T138)
    const tell = (next: GuideState, now: number) => {
      if (next === 'none' && now - seenAt <= DROP_MS) return;
      if (next !== 'none') seenAt = now;
      if (next !== said) { said = next; setState(next); }
    };
    const tick = (now: number) => {
      if (stopped) return;
      frame = requestAnimationFrame(tick);
      const v = video.current;
      if (!detector || !v || v.readyState < 2 || now - last < 80) return;
      last = now;
      const box = { width: v.clientWidth, height: v.clientHeight };
      const fit = fitOf(box, { width: v.videoWidth, height: v.videoHeight }, 'cover');
      const picture = { width: v.videoWidth, height: v.videoHeight };
      let target: Pose | null = null;
      try {
        if (onFace) {
          const found = detector.detectForVideo(v, now).faceLandmarks?.[0] as Landmark[] | undefined;
          const lm = found ? (mirror ? mirrored(found) : found) : null;
          const f = lm ? facePoints(lm, picture, fit) : null;
          sighting.current = lm && f ? { landmarks: lm, score: 1, mirrored: mirror } : null;
          tell(faceFeedback(f, box), now);
          if (f && product) target = placeOnFace(kind === 'necklace' ? 'necklace' : 'glasses', f, product.caseMm, aspect, mirror);
        } else {
          const result = detector.detectForVideo(v, now);
          const found = result.landmarks?.[0] as Landmark[] | undefined;
          const lm = found ? (mirror ? mirrored(found) : found) : null;
          const h = lm ? handPoints(lm, picture, fit) : null;
          const score = result.handedness?.[0]?.[0]?.score ?? 0.5;
          sighting.current = lm && h ? { landmarks: lm, score, mirrored: mirror } : null;
          tell(handFeedback(handKind, h, box), now);
          if (h && product) target = placeOnHand(handKind, h, product.caseMm, aspect, score);
        }
      } catch { /* a dropped frame */ }
      // auto capture: ready and held still
      const ready = said === 'ready' && target && autoOn.current;
      const step = stepAuto(steady, now, ready ? target : null, box.width);
      steady = step.state;
      if (Math.abs(step.progress - shown) >= 0.08 || (step.progress === 0) !== (shown === 0)) {
        shown = step.progress; setHold(step.progress); setPhase(step.progress > 0 && step.progress < 1 ? 'steady' : null);
      }
      if (step.fire) shoot.current(true);
      const el = liveProduct.current;
      if (!el) return;
      // nothing this look: a dropped frame keeps the product where it was; gone longer, it fades out
      if (!target) {
        if (drawn && now - seenAt <= DROP_MS) return;
        drawn = null; smoothing = null; el.style.opacity = '0'; return;
      }
      const next = smooth(smoothing, target, now);
      smoothing = next.state; drawn = next.pose;
      place(el, drawn, aspect, SHADOW[kind]);
      // T140.2: the live product a little darker in a dim room, measured from the camera every second and a half
      if (now - litAt > 1500) {
        litAt = now;
        try {
          const g = (lightCanvas ??= Object.assign(document.createElement('canvas'), { width: 48, height: 48 })).getContext('2d', { willReadFrequently: true })!;
          g.drawImage(v, 0, 0, 48, 48);
          const img = el.firstElementChild as HTMLElement | null;
          if (img) img.style.filter = `brightness(${tintOf(lightOf(g.getImageData(0, 0, 48, 48).data)).brightness.toFixed(2)})`;
        } catch { /* a frame that could not be read */ }
      }
      el.style.opacity = '1';
    };
    frame = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(frame); };
  }, [view, camera, onFace, mirror, kind, handKind, detects, product, aspect, asset]);

  // ── Shots ─────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Where the guide shows the product, on the live frame's pixels (the screen's guide → the video's picture). */
  function guideHint(): GuideHint | null {
    const v = video.current;
    const svg = main.current?.querySelector<SVGSVGElement>('svg.cap-guide');
    const ctm = svg?.getScreenCTM();
    if (!v || !ctm || !product || !v.videoWidth) return null;
    const gp = guideProduct(kind, side, product.caseMm, aspect);
    const at = new DOMPoint(gp.x, gp.y).matrixTransform(ctm);
    const r = v.getBoundingClientRect();
    const fit = fitOf({ width: r.width, height: r.height }, { width: v.videoWidth, height: v.videoHeight }, 'cover');
    return {
      pose: { x: (at.x - r.left - fit.ox) / fit.scale, y: (at.y - r.top - fit.oy) / fit.scale, width: (gp.width * ctm.a) / fit.scale, angle: gp.angle },
      frame: { width: v.videoWidth, height: v.videoHeight },
    };
  }

  /**
   * Place the product on a still. T138: first a fresh look at the photo itself — the whole picture, at its full size,
   * with every harder look (`detect-views.ts`): more exact than the live preview's last sighting, which is a frame or
   * two older and from the lighter video tracking; then that live sighting (the detector saw it a moment ago); then
   * where the guide showed it (the shopper lined up with it).
   */
  async function placeOn(img: HTMLImageElement, seen: Sighting | null, hint: GuideHint | null): Promise<{ pose: Pose | null; how: 'found' | 'guide' | 'none'; detail?: string | null }> {
    const size = { width: img.naturalWidth, height: img.naturalHeight };
    const flat = { scale: 1, ox: 0, oy: 0 };
    if (!product) return { pose: null, how: 'none' };
    const fromGuide = (): { pose: Pose | null; how: 'guide' | 'none' } => {
      if (!hint) return { pose: null, how: 'none' };
      const k = size.width / hint.frame.width; // the photo may have been made smaller than the frame
      return { pose: { x: hint.pose.x * k, y: hint.pose.y * k, width: hint.pose.width * k, angle: hint.pose.angle }, how: 'guide' };
    };
    if (!detects) return fromGuide();
    try {
      if (onFace) {
        const fresh = await detectFace(await model('face', 'IMAGE', asset), img);
        let lm = (fresh?.faceLandmarks[0] as Landmark[] | undefined) ?? null;
        // the live sighting was flipped with the front camera's picture; a fresh look at the (flipped) still is not
        const flipped = !lm && seen?.mirrored === true;
        const detail = lm ? fresh!.how : seen ? 'live' : null;
        lm ??= seen?.landmarks ?? null;
        const f = lm ? facePoints(lm, size, flat) : null;
        return f ? { pose: placeOnFace(kind === 'necklace' ? 'necklace' : 'glasses', f, product.caseMm, aspect, flipped), how: 'found', detail } : fromGuide();
      }
      const found = await detectHand(await model('hand', 'IMAGE', asset), img);
      let lm: Landmark[] | null = (found?.landmarks[0] as Landmark[] | undefined) ?? null, score = found?.score ?? 0.5;
      let detail: string | null = found?.how ?? null;
      if (!lm && seen) { lm = seen.landmarks; score = seen.score; detail = 'live'; }
      const h = lm ? handPoints(lm, size, flat) : null;
      return h ? { pose: placeOnHand(handKind, h, product.caseMm, aspect, score), how: 'found', detail } : fromGuide();
    } catch {
      return fromGuide();
    }
  }

  async function keep(blob: Blob, seen: Sighting | null, hint: GuideHint | null, stay = false, source: 'camera' | 'upload' = 'camera') {
    setBusy(true); setError('');
    try {
      const prepared = await preparePhoto(blob);
      const img = await loadImage(prepared.dataUrl);
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      const placed = await placeOn(img, seen, hint);
      const sized = placed.pose ? { ...placed.pose, width: placed.pose.width * HAND_SIZE[handSize] } : null;
      // nothing to go by: the product in the middle at about its usual share of the picture, to be moved by hand
      const start = sized ?? (product && kind !== 'earring' ? { x: size.width / 2, y: size.height / 2, width: size.width * START_SHARE[kind], angle: 0 } : null);
      const fill = fillFor(screen, size, start);
      const next: Shot = { id: nextId.current++, dataUrl: prepared.dataUrl, blob: prepared.blob, size, fill, pose: start, auto: sized, first: start, taps: [], sent: false, tint: tintOf(measureLight(img)), source, found: placed.how === 'found' ? 'detected' : placed.how, how: placed.detail ?? null };
      setShots((was) => [...was, next].slice(-MAX_SHOTS));
      setCurrent(next.id);
      if (stay) { setFlash((f) => f + 1); return; } // auto: the camera stays for another pose
      setView('result');
      if (kind === 'earring' && product && !sized) setNote(t('اضغط أعلى أذنك، ثم أسفل شحمة الأذن', 'Tap the top of your ear, then the bottom of your earlobe'));
      else if (product && placed.how === 'guide') setNote(t('وُضع حيث أشار الإطار — حرّكه بإصبعك عند الحاجة', 'Placed where the outline showed — drag it if needed'));
      else if (product && placed.how === 'none') setNote(t('حرّك المنتج بإصبعك إلى مكانه، وكبّره أو صغّره بإصبعين', 'Drag the product into place; pinch to size and turn it'));
    } catch {
      setError(t('تعذّر فتح الصورة. اختر JPG أو PNG أو WebP أقل من 20 ميجابايت.', 'This photo could not be opened. Choose a JPG, PNG or WebP under 20 MB.'));
    } finally { setBusy(false); }
  }

  async function capture(fromAuto = false) {
    const v = video.current;
    if (!v || !v.videoWidth || busy) return;
    const seen = sighting.current;
    const hint = guideHint();
    if (fromAuto) setPhase('capturing');
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    const g = c.getContext('2d')!;
    if (mirror) { g.translate(c.width, 0); g.scale(-1, 1); } // what the shopper saw, as in a mirror
    g.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/jpeg', 0.9));
    if (blob) await keep(blob, seen, hint, fromAuto);
    if (fromAuto) setPhase(null);
  }
  shoot.current = (fromAuto) => { void capture(fromAuto); };

  function choose(f: File | undefined) { if (f) void keep(f, null, null, false, 'upload'); }

  function update(id: number, change: (s: Shot) => Shot) { setShots((was) => was.map((s) => (s.id === id ? change(s) : s))); }

  function remove(id: number) {
    const left = shots.filter((s) => s.id !== id);
    setShots(left);
    if (current === id) setCurrent(left.at(-1)?.id ?? null);
    if (!left.length) setView(camera === 'off' ? 'pick' : 'camera');
  }

  /** A smaller or larger hand than the average: every photo's product grows or shrinks by the same share. */
  function resize(next: HandSize) {
    const k = HAND_SIZE[next] / HAND_SIZE[handSize];
    setHandSize(next);
    setShots((was) => was.map((s) => ({ ...s, pose: s.pose && { ...s.pose, width: s.pose.width * k }, auto: s.auto && { ...s.auto, width: s.auto.width * k } })));
  }

  // T140.5: each photo counted once, anonymously — what happened to it and whether the shopper moved the product
  const telemetry = useTelemetry();
  const reportedShots = useRef(new Set<number>());
  const shotsNow = useRef<Shot[]>([]);
  shotsNow.current = shots;
  function reportShot(s: Shot) {
    if (reportedShots.current.has(s.id) || !product) return;
    reportedShots.current.add(s.id);
    sendTryOn(telemetry, [photoEvent({ kind, source: s.source ?? 'camera', found: s.found ?? 'none', how: s.how, moved: movedFrom(s.first, s.pose) })]);
  }
  const reportAll = useRef(() => {});
  reportAll.current = () => shotsNow.current.forEach(reportShot);
  useEffect(() => {
    // leaving, or put in the background (a phone often never says it leaves): counted once either way
    const leave = () => reportAll.current();
    const hidden = () => { if (document.visibilityState === 'hidden') leave(); };
    window.addEventListener('pagehide', leave);
    document.addEventListener('visibilitychange', hidden);
    return () => { window.removeEventListener('pagehide', leave); document.removeEventListener('visibilitychange', hidden); leave(); };
  }, []);

  async function send() {
    if (!shot || busy || !onSend) return;
    setBusy(true); setError('');
    try {
      await onSend(shot);
      update(shot.id, (s) => ({ ...s, sent: true }));
      reportShot(shot);
      setNote(t('أُرسلت إلى شاشتك — ويمكنك إرسال صور أخرى', 'Sent to your screen — you can send more'));
    } catch (e) {
      setError(ended(e) ? t('انتهت هذه الجلسة. امسح رمزًا جديدًا لإرسال الصورة.', 'This session has ended. Scan a new code to send the photo.')
        : waiting(e) ? t('صور كثيرة بانتظار شاشتك — افتحها لتستلمها، ثم أرسل غيرها.', 'Several photos are waiting for your screen — open it to receive them, then send more.')
          : t('تعذّر الإرسال. حاول مجددًا.', 'Could not send. Try again.'));
    } finally { setBusy(false); }
  }

  /**
   * The photo with the product on it, as one picture: shared through the phone's own sheet, or saved — made at once and
   * shared inside the tap (T137: awaiting the pictures first made a phone refuse the share).
   */
  function share() {
    if (!shot || !product || !shot.pose) return;
    const item = shareItem.current;
    const photo = shotPicture.current?.id === shot.id ? shotPicture.current.img : null;
    if (!item || !photo) { setNote(t('لحظة… الصورة تُجهَّز، اضغط مرة أخرى', 'One moment — the picture is being prepared; tap again')); return; }
    setError('');
    try {
      const c = document.createElement('canvas');
      c.width = shot.size.width; c.height = shot.size.height;
      const g = c.getContext('2d')!;
      g.drawImage(photo, 0, 0);
      const p = shot.pose, h = p.width * aspect;
      castShadow(g, item, { x: p.x, y: p.y, width: p.width, height: h, angle: p.angle }, SHADOW[kind]);
      g.save(); g.translate(p.x, p.y); g.rotate((p.angle * Math.PI) / 180); g.drawImage(softEdged(litProduct(item, shot.tint ?? NEUTRAL), p.width), -p.width / 2, -h / 2, p.width, h); g.restore();
      const fileName = `${(brand ? brand.name.en : product.name.en).replace(/[^\w-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'tajribah-try-on'}.jpg`; // an Arabic name leaves no letters: ours
      const file = new File([dataUrlBlob(c.toDataURL('image/jpeg', 0.92))], fileName, { type: 'image/jpeg' });
      const name = t(product.name.ar, product.name.en);
      void sharePicture(file, { title: name, text: inviteText(name, shareLink, lang === 'ar'), url: shareLink }).then((how) => {
        if (how === 'saved') setNote(t('حُفظت الصورة', 'Picture saved'));
        if (how !== 'cancelled') { reportShot(shot); sendTryOn(telemetry, [shareEvent(how === 'shared' ? 'shared' : 'saved', 'camera')]); } // T140.5
      });
    } catch {
      setError(t('تعذّرت المشاركة. التقط صورة للشاشة بدلًا من ذلك.', 'Could not share. Take a screenshot instead.'));
    }
  }

  // ── Moving the product on a shot ──────────────────────────────────────────────────────────────────────────────
  const [sheetHeight, setSheetHeight] = useState(0);
  const sheet = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = sheet.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const watch = new ResizeObserver(() => setSheetHeight(el.offsetHeight));
    watch.observe(el);
    return () => watch.disconnect();
  }, [view, shot?.id]);
  // the gradient's clear top part may overlap the product; the buttons and text below it may not
  const fit: Fit | null = useMemo(
    () => (shot ? liftedAbove(fitOf(screen, shot.size, shot.fill), shot.first, aspect, screen.height - Math.max(0, sheetHeight - 36)) : null),
    [shot, screen, aspect, sheetHeight],
  );
  const touches = useRef(new Map<number, Pt>());
  const gesture = useRef<{ start: Pose; points: Map<number, Pt> } | null>(null);

  function down(e: React.PointerEvent<HTMLDivElement>) {
    if (!shot || !fit) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const p = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (kind === 'earring' && product && !shot.pose && shot.taps.length < 2) {
      const taps = [...shot.taps, onPicture(p, fit)];
      update(shot.id, (s) => {
        if (taps.length < 2) return { ...s, taps };
        const pose = earringPlacement(taps[0]!, taps[1]!, product.caseMm, aspect);
        return { ...s, taps, pose, auto: pose, first: pose };
      });
      if (taps.length === 1) setNote(t('والآن أسفل شحمة الأذن', 'Now the bottom of your earlobe'));
      return;
    }
    if (!shot.pose) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    touches.current.set(e.pointerId, p);
    gesture.current = { start: shot.pose, points: new Map(touches.current) };
  }
  function move(e: React.PointerEvent<HTMLDivElement>) {
    if (!shot || !fit || !gesture.current || !touches.current.has(e.pointerId)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    touches.current.set(e.pointerId, { x: e.clientX - rect.left, y: e.clientY - rect.top });
    const { start, points } = gesture.current;
    const ids = [...points.keys()].filter((id) => touches.current.has(id));
    let pose: Pose;
    if (ids.length >= 2) {
      const [a, b] = ids as [number, number];
      pose = pinched(start, points.get(a)!, points.get(b)!, touches.current.get(a)!, touches.current.get(b)!, fit, shot.size.width * 1.5);
    } else {
      const id = ids[0]!;
      const from = points.get(id)!, to = touches.current.get(id)!;
      pose = dragged(start, to.x - from.x, to.y - from.y, fit);
    }
    update(shot.id, (s) => ({ ...s, pose }));
  }
  function up(e: React.PointerEvent<HTMLDivElement>) {
    touches.current.delete(e.pointerId);
    // the fingers left start a new gesture from where the product is now
    gesture.current = touches.current.size && shot?.pose ? { start: shot.pose, points: new Map(touches.current) } : null;
  }

  const trueSize = shot?.pose && shot.auto && Math.abs(shot.pose.width / shot.auto.width - 1) > 0.03;
  const sizeLine = product ? t(`بمقاسه الحقيقي · العرض ${product.caseMm} مم`, `At its real size · ${product.caseMm} mm wide`) : '';
  const sizeOf = onFace ? (kind === 'earring' ? t('أذني', 'My ear') : t('وجهي', 'My face')) : t('يدي', 'My hand');
  const last = shots.at(-1);

  // ── The page ──────────────────────────────────────────────────────────────────────────────────────────────────
  const top = (
    <header className="cap-top">
      <span className="cap-brand">{brand ? <StoreMark brand={brand} /> : product ? t(product.name.ar, product.name.en) : null}</span>
      <span className="cap-top-tools">
        {view === 'camera' && <button type="button" className="cap-chip" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label={t('بدّل الكاميرا', 'Switch camera')}><SwitchCamera size={16} /></button>}
        {onClose && <button type="button" className="cap-chip" onClick={onClose} aria-label={t('أغلق', 'Close')}><X size={16} /></button>}
      </span>
    </header>
  );
  const sideSwitch = HAS_SIDE[kind] && (
    <div className="cap-side" role="radiogroup" aria-label={kind === 'earring' ? t('أي أذن', 'Which ear') : t('أي يد', 'Which hand')}>
      {(['left', 'right'] as const).map((s) => {
        const Icon = kind === 'earring' ? Ear : Hand;
        const label = kind === 'earring' ? (s === 'left' ? t('الأذن اليسرى', 'Left ear') : t('الأذن اليمنى', 'Right ear')) : s === 'left' ? t('اليد اليسرى', 'Left hand') : t('اليد اليمنى', 'Right hand');
        return (
          <button key={s} type="button" role="radio" aria-checked={side === s} aria-label={label} title={label} className={side === s ? 'is-on' : ''} onClick={() => setSide(s)}>
            <Icon size={20} style={s === 'right' ? { transform: 'scaleX(-1)' } : undefined} aria-hidden />
          </button>
        );
      })}
    </div>
  );

  return (
    <main ref={main} className={`cap cap-${view}`} dir={lang === 'ar' ? 'rtl' : 'ltr'} data-kind={kind}>
      {view === 'camera' && (
        <>
          <video ref={video} className={'cap-video' + (mirror ? ' cap-mirror' : '')} playsInline muted autoPlay aria-label={t('الكاميرا', 'Camera')} />
          <Guide kind={kind} state={state} side={side} product={guideFor} className="cap-guide" />
          {product && (
            <div ref={liveProduct} className="cap-live-product" style={{ opacity: 0 }} aria-hidden>
              <img src={worn} alt="" draggable={false} />
            </div>
          )}
          {flash > 0 && <div key={flash} className="cap-flash" aria-hidden />}
          {top}
          <div className="cap-banner">
            <p className={`cap-say cap-say-${phase ?? state}`} role="status" aria-live="polite">
              {camera === 'starting' ? t('جارٍ تشغيل الكاميرا…', 'Starting the camera…') : <>{state === 'ready' && !phase && <Check size={16} aria-hidden />}{guideText(kind, state, t, phase, auto)}</>}
            </p>
            {auto && <button type="button" className="cap-link cap-manual" onClick={() => setAuto(false)}>{t('واجهت مشكلة؟ جرّب اليدوي', 'Having trouble? Try manual')}</button>}
          </div>
          <div className="cap-bottom">
            {sideSwitch}
            <div className="cap-controls">
              {last
                ? (
                  <button type="button" className="cap-last" onClick={() => { setCurrent(last.id); setView('result'); }} aria-label={t(`صورك (${shots.length})`, `Your photos (${shots.length})`)}>
                    <img key={last.id} src={last.dataUrl} alt="" /><b>{shots.length}</b>
                  </button>
                )
                : <button type="button" className="cap-round" onClick={() => gallery.current?.click()} aria-label={t('اختر من الصور', 'Choose from photos')}><ImagePlus size={22} /></button>}
              <button type="button" className={`cap-shutter${state === 'ready' ? ' is-ready' : ''}`} style={{ '--hold': hold } as React.CSSProperties}
                onClick={() => void capture()} disabled={camera !== 'live' || busy} aria-label={t('التقط', 'Take the photo')}>
                {busy ? <LoaderCircle className="spin" size={26} /> : <span />}
              </button>
              {detects
                ? (
                  <button type="button" role="switch" aria-checked={auto} className={'cap-auto' + (auto ? ' is-on' : '')} onClick={() => setAuto((a) => !a)}>
                    <i aria-hidden /><span>{t('تلقائي', 'Auto')}</span>
                  </button>
                )
                : <span className="cap-auto-space" />}
            </div>
            {!shots.length && <Privacy t={t} />}
          </div>
        </>
      )}

      {view === 'pick' && (
        <>
          {top}
          <div className="cap-pick">
            <Guide kind={kind} side={side} product={guideFor} className="cap-guide-still" />
            {sideSwitch}
            <p className="cap-say">{guideText(kind, 'idle', t, null, false)}</p>
            <button type="button" className="cap-primary" disabled={busy} onClick={() => nativeCamera.current?.click()}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <Camera size={18} />} {t('التقط صورة', 'Take a photo')}
            </button>
            <button type="button" className="cap-secondary" disabled={busy} onClick={() => gallery.current?.click()}><ImagePlus size={17} /> {t('اختر من الصور', 'Choose from photos')}</button>
            {camera === 'off' && typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && (
              <button type="button" className="cap-link" onClick={() => setView('camera')}><RefreshCw size={14} /> {t('جرّب الكاميرا المباشرة مجددًا', 'Try the live camera again')}</button>
            )}
            {!shots.length && <Privacy t={t} />}
          </div>
        </>
      )}

      {view === 'result' && shot && fit && (
        <>
          <div className="cap-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <img className="cap-photo" src={shot.dataUrl} alt={t('صورتك', 'Your photo')} draggable={false}
              style={{ left: fit.ox, top: fit.oy, width: shot.size.width * fit.scale, height: shot.size.height * fit.scale }} />
            {product && shot.pose && <Placed pose={onScreen(shot.pose, fit)} aspect={aspect} kind={SHADOW[kind]} src={shareItem.current && shot.tint ? litUrl(shareItem.current, shot.tint) : worn} alt={t(product.name.ar, product.name.en)} />}
            {kind === 'earring' && !shot.pose && shot.taps.map((p, i) => (
              <span key={i} className="cap-tap" style={{ left: fit.ox + p.x * fit.scale, top: fit.oy + p.y * fit.scale }} />
            ))}
          </div>
          {top}
          <p className="cap-disclaimer">{t('الصورة للتوضيح فقط، وقد يختلف المقاس الفعلي قليلًا.', 'For illustration only — the actual size may differ slightly.')}</p>
          <div className="cap-sheet" ref={sheet}>
            {product && (
              <div className="cap-sheet-head">
                <strong>{t(product.name.ar, product.name.en)}</strong>
                <span><Ruler size={13} aria-hidden /> {sizeLine}</span>
                {trueSize && <button type="button" className="cap-link" onClick={() => update(shot.id, (s) => ({ ...s, pose: s.pose && s.auto ? { ...s.pose, width: s.auto.width } : s.pose }))}>{t('أعد المقاس الحقيقي', 'Back to real size')}</button>}
              </div>
            )}
            {product && shot.auto && (
              <div className="cap-size" role="radiogroup" aria-label={sizeOf}>
                <span>{sizeOf}:</span>
                {(['small', 'medium', 'large'] as const).map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={handSize === s} className={handSize === s ? 'is-on' : ''} onClick={() => resize(s)}>
                    {s === 'small' ? t('صغير', 'Small') : s === 'medium' ? t('متوسط', 'Medium') : t('كبير', 'Large')}
                  </button>
                ))}
              </div>
            )}
            {shots.length > 1 && (
              <div className="cap-thumbs" role="list">
                {shots.map((s) => (
                  <div key={s.id} role="listitem" className={'cap-thumb' + (s.id === shot.id ? ' is-on' : '')}>
                    <button type="button" onClick={() => setCurrent(s.id)} aria-label={t('اعرض هذه الصورة', 'Show this photo')}><img src={s.dataUrl} alt="" /></button>
                    <button type="button" className="cap-thumb-x" onClick={() => remove(s.id)} aria-label={t('احذف', 'Delete')}><X size={12} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className={'cap-actions' + (onSend || onUse ? ' has-three' : '')}>
              <button type="button" className="cap-secondary" onClick={() => setView(camera === 'off' ? 'pick' : 'camera')}><Camera size={17} /> {t('صورة أخرى', 'Another photo')}</button>
              {product && shot.pose && <button type="button" className="cap-icon" disabled={busy} onClick={share} aria-label={t('شارك الصورة أو احفظها', 'Share or save the picture')} title={t('شارك أو احفظ', 'Share or save')}><Share2 size={20} /></button>}
              {onUse && <button type="button" className="cap-primary" onClick={() => { reportShot(shot); onUse(shot); }}><Check size={17} /> {t('استخدم هذه الصورة', 'Use this photo')}</button>}
              {onSend && (
                <button type="button" className={product ? 'cap-secondary' : 'cap-primary'} disabled={busy || shot.sent} onClick={() => void send()}>
                  {busy ? <LoaderCircle className="spin" size={17} /> : shot.sent ? <Check size={17} /> : <Monitor size={17} />} {shot.sent ? t('على شاشتك', 'On your screen') : t('أرسل إلى شاشتي', 'Send to my screen')}
                </button>
              )}
            </div>
          </div>
        </>
      )}

      {note && <p className="cap-note" role="status">{note}</p>}
      {error && <p className="cap-error" role="alert">{error}</p>}
      <input className="sr-only" ref={nativeCamera} type="file" capture={onFace ? 'user' : 'environment'} accept="image/*" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
      <input className="sr-only" ref={gallery} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { choose(e.target.files?.[0]); e.target.value = ''; }} />
    </main>
  );
}

/** The server said the session is over (it expired, or the computer closed it). */
function ended(e: unknown) { return e instanceof Error && /expired|scan a new code/i.test(e.message); }
/** T139: the session holds a few photos at once; more wait for the screen to take them. */
function waiting(e: unknown) { return e instanceof Error && /photos are waiting/i.test(e.message); }

/** The product drawn at `pose` (screen pixels): an unturned box carries the shadow, so the light stays above. */
function Placed({ pose, aspect, kind, src, alt }: { pose: Pose; aspect: number; kind: ShadowKind; src: string; alt: string }) {
  const height = pose.width * aspect;
  return (
    <div className="cap-placed" style={{ filter: cssShadow(kind, pose.width) }}>
      <img src={src} alt={alt} draggable={false} data-pose={`${Math.round(pose.x)},${Math.round(pose.y)},${Math.round(pose.width)},${Math.round(pose.angle)}`}
        style={{ left: pose.x - pose.width / 2, top: pose.y - height / 2, width: pose.width, height, transform: `rotate(${pose.angle}deg)` }} />
    </div>
  );
}

/** The live product follows the hand: styled directly, a dozen times a second, without a React render. */
function place(el: HTMLDivElement, pose: Pose, aspect: number, kind: ShadowKind) {
  const img = el.firstElementChild as HTMLImageElement | null;
  if (!img) return;
  const height = pose.width * aspect;
  el.style.filter = cssShadow(kind, pose.width);
  img.style.left = `${pose.x - pose.width / 2}px`;
  img.style.top = `${pose.y - height / 2}px`;
  img.style.width = `${pose.width}px`;
  img.style.height = `${height}px`;
  img.style.transform = `rotate(${pose.angle}deg)`;
  img.dataset.pose = `${Math.round(pose.x)},${Math.round(pose.y)},${Math.round(pose.width)},${Math.round(pose.angle)}`;
}

function Privacy({ t }: { t: <T>(ar: T, en: T) => T }) {
  return (
    <p className="cap-privacy">
      {t('تبقى صورك على جوالك. وإن أرسلتها إلى شاشتك تُحذف فور استلامها أو بعد 30 دقيقة.', 'Your photos stay on your phone. One you send to your screen is deleted when received, or after 30 minutes.')}{' '}
      <SiteLink href="/try-on-privacy">{t('التفاصيل', 'Details')}</SiteLink>
    </p>
  );
}
