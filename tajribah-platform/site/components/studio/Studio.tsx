'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera, Check, ChevronRight, Download, Expand, Hand, HelpCircle, ImagePlus, LoaderCircle,
  Maximize2, Minus, Move, Plus, QrCode, RotateCcw, Ruler, Smartphone, Upload, X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { Tabs, TabsList, TabsTrigger } from '@site/components/ui/tabs';
import { Slider } from '@site/components/ui/slider';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@site/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@site/components/ui/select';
import { Switch } from '@site/components/ui/switch';
import { useLang } from '@site/lib/i18n';
import { useSiteEnv } from '@site/lib/site-env';
import { preparePhoto } from '@site/lib/photo';
import {
  DEMO_WATCH, PX_PER_MM, REFERENCES, STAGE, constrainToModel, modelsFor,
  type ModelId, type Pose, type ReferenceId, type TryOnProduct,
} from '@site/lib/demo-product';

type Mode = 'model' | 'me' | 'compare';
const { W, H } = STAGE;
const REF_IDS = Object.keys(REFERENCES) as ReferenceId[];

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Image could not be loaded'));
    i.src = src;
  });

/** `product`: the watch to try on — the Failet demo unless a merchant's own is given (P5, T26). */
export default function Studio({ product = DEMO_WATCH }: { product?: TryOnProduct } = {}) {
  const { lang } = useLang();
  const { asset, features } = useSiteEnv();
  const ar = lang === 'ar';
  const t = useCallback((en: string, arabic: string) => (ar ? arabic : en), [ar]);

  // T68: glasses use a face photo and their own few words; a watch is exactly as before.
  const { models: MODELS, baseMm } = modelsFor(product);
  const isGlasses = product.category === 'eyewear';
  const isRing = product.category === 'ring';
  const isNecklace = product.category === 'necklace';
  const isBag = product.category === 'bag';
  const isEarring = product.category === 'earring';
  const [mode, setMode] = useState<Mode>('model');
  const [model, setModel] = useState(0);
  // On the model photos the poses are tuned to the demo watch; another watch is drawn in
  // proportion to its case width, so the size shown is true (Nader, 2026-09-28). The demo: factor 1.
  const modelPose = (i: number): Pose => {
    const k = product.caseMm / baseMm;
    return k === 1 ? { ...MODELS[i].pose } : { ...MODELS[i].pose, width: MODELS[i].pose.width * k };
  };
  const [pose, setPose] = useState<Pose>(modelPose(0));
  const [scale, setScale] = useState(100);
  const [zoom, setZoom] = useState(1);
  const [units, setUnits] = useState('mm');
  const [rulers, setRulers] = useState(true);
  const [ref, setRef] = useState<ReferenceId>(isRing ? 'riyal' : 'iphone'); // a ring beside a coin; a watch, as before
  const [refPose, setRefPose] = useState({ x: 790, y: 550, angle: 0 });
  const [active, setActive] = useState<'watch' | 'object'>('watch');
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoFit, setPhotoFit] = useState<Pose>({ x: 600, y: 570, width: 155, angle: 0 });
  const [photoBusy, setPhotoBusy] = useState(false);
  const [calibrating, setCalibrating] = useState(false);
  const [points, setPoints] = useState<{ x: number; y: number }[]>([]);
  const [qrOpen, setQrOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [pair, setPair] = useState<{ id: string; expiresAt: number } | null>(null);
  const [qrImage, setQrImage] = useState('');
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState('');
  const [notice, setNotice] = useState('');
  const [loaded, setLoaded] = useState<ReadonlySet<string>>(() => new Set());
  // Ready = the pictures this view draws are in (T31: they arrive in two steps).
  const needed = mode === 'model' ? [model ? 'lifestyle' : 'wrist', 'watch', ...(MODELS[model]?.front ? ['front'] : [])] : mode === 'compare' ? ['flat', ref] : ['watch'];
  const assetsReady = needed.every((key) => loaded.has(key));
  const [assetError, setAssetError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isPhone, setIsPhone] = useState(false);

  const canvas = useRef<HTMLCanvasElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const images = useRef<Record<string, HTMLImageElement>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handDetector = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const faceDetector = useRef<any>(null); // T68: glasses on the shopper's own photo
  const drag = useRef<{ x: number; y: number; start: Pose; target: 'watch' | 'object' } | null>(null);
  const gestures = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ distance: number; zoom: number } | null>(null);
  const photoRequest = useRef(0);
  const notify = (message: string) => setNotice(message);

  useEffect(() => { setIsPhone(/Android|iPhone|iPad/i.test(navigator.userAgent)); }, []);
  useEffect(() => {
    if (!notice) return;
    const id = setTimeout(() => setNotice(''), 6000);
    return () => clearTimeout(id);
  }, [notice]);
  // The first view needs the wrist photo and the watch; the lifestyle photo, the flat shot and the
  // reference objects load right after, so a phone draws the watch without waiting for all seven
  // (Nader, 2026-09-28, T31). A view whose pictures are not in yet shows the loader, as before.
  useEffect(() => {
    let live = true;
    const first: Record<string, string> = { wrist: MODELS[0].src, watch: product.worn, ...(MODELS[0].front ? { front: MODELS[0].front } : {}) };
    const later: Record<string, string> = { ...(MODELS[1] ? { lifestyle: MODELS[1].src } : {}), flat: product.flat };
    for (const id of REF_IDS) later[id] = REFERENCES[id].src;
    const load = (paths: Record<string, string>) => Promise.all(Object.entries(paths).map(async ([key, url]) => {
      const image = await loadImage(asset(url));
      if (live) { images.current[key] = image; setLoaded((was) => new Set(was).add(key)); }
    }));
    load(first).then(() => load(later)).catch(() => { if (live) setAssetError(true); });
    return () => { live = false; };
  }, [asset, product.worn, product.flat, MODELS]);
  useEffect(() => () => handDetector.current?.close(), []);
  useEffect(() => () => faceDetector.current?.close(), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setExpanded(false); setCalibrating(false); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  function reset(nextMode: Mode = mode, nextModel = model) {
    // a product wider than the stage at true scale (a bag) starts the comparison zoomed out; a watch at 1
    setScale(100); setZoom(nextMode === 'compare' && product.caseMm * PX_PER_MM > 900 ? 0.65 : 1); setCalibrating(false); setPoints([]); setActive('watch');
    setPose(
      nextMode === 'model' ? modelPose(nextModel)
        // a wide product (glasses) starts further left, clear of the reference object; a watch stays at 365
        : nextMode === 'compare' ? { x: compareStartX(), y: 550, width: product.caseMm * PX_PER_MM, angle: 0 }
          : { ...photoFit },
    );
    setRefPose({ x: refStartX(), y: 550, angle: 0 });
  }
  /**
   * Where the product starts in the comparison: a watch at 365 as before; a wide one further left; one
   * wider than the stage (a bag, shown zoomed out) centred with the reference beside it.
   */
  function compareStartX() {
    const w = product.caseMm * PX_PER_MM;
    if (w > 900) return W / 2 - (40 * PX_PER_MM + 160) / 2;
    return Math.max(w / 2 + 40, Math.min(365, 590 - w / 2));
  }
  /** Where the reference object starts: clear of a wide product (a necklace, a bag); beside a watch, 790 as before. */
  function refStartX() {
    const w = product.caseMm * PX_PER_MM;
    if (w > 900) return compareStartX() + w / 2 + 40 * PX_PER_MM + 160 / 2; // the zoomed-out view has room
    return Math.min(W - 120, Math.max(790, compareStartX() + w / 2 + 200));
  }
  function changeMode(value: string) { const next = value as Mode; setMode(next); reset(next); }
  function changeModel(next: number) { setModel(next); reset('model', next); }
  const measure = (mm: number) =>
    units === 'mm' ? `${Number(mm.toFixed(1))} ${t('mm', 'مم')}` : `${(mm / 25.4).toFixed(2)} ${t('in', 'بوصة')}`;

  const redraw = useCallback(() => {
    const c = canvas.current;
    if (!c || !assetsReady) return;
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, W, H);
    ctx.save();
    ctx.direction = ar ? 'rtl' : 'ltr';
    ctx.translate(W / 2, H / 2); ctx.scale(zoom, zoom); ctx.translate(-W / 2, -H / 2);

    if (mode === 'model') ctx.drawImage(images.current[model ? 'lifestyle' : 'wrist'], 0, 0, W, H);
    if (mode === 'me' && photo && images.current.photo) {
      const im = images.current.photo;
      const f = Math.min(W / im.width, H / im.height);
      ctx.drawImage(im, (W - im.width * f) / 2, (H - im.height * f) / 2, im.width * f, im.height * f);
    }
    if (mode === 'compare') {
      ctx.strokeStyle = '#E7ECEA'; ctx.lineWidth = 1;
      for (let x = 0; x < W; x += 43) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
      for (let y = 0; y < H; y += 43) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }
      const ob = REFERENCES[ref];
      const width = ob.w * PX_PER_MM, height = ob.h * PX_PER_MM;
      ctx.save();
      ctx.translate(refPose.x, refPose.y); ctx.rotate((refPose.angle * Math.PI) / 180);
      ctx.drawImage(images.current[ref], -width / 2, -height / 2, width, height);
      if (active === 'object') {
        ctx.setLineDash([7, 6]); ctx.strokeStyle = '#00A7BC'; ctx.lineWidth = 2;
        ctx.strokeRect(-width / 2 - 12, -height / 2 - 12, width + 24, height + 24); ctx.setLineDash([]);
      }
      if (rulers) {
        ctx.fillStyle = '#0A2237'; ctx.font = '19px "IBM Plex Sans Arabic", Arial, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(measure(ob.w), 0, height / 2 + 44);
      }
      ctx.restore();
    }
    if (mode !== 'me' || photo) {
      const im = images.current[mode === 'compare' ? 'flat' : 'watch'];
      const width = (pose.width * scale) / 100, height = (width * im.height) / im.width;
      ctx.save();
      ctx.translate(pose.x, pose.y); ctx.rotate((pose.angle * Math.PI) / 180);
      ctx.shadowColor = 'rgba(10,34,55,.2)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
      ctx.drawImage(im, -width / 2, -height / 2, width, height);
      ctx.shadowColor = 'transparent';
      if (rulers) {
        const y = height / 2 + 26;
        ctx.strokeStyle = '#00A7BC'; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(-width / 2, y); ctx.lineTo(width / 2, y);
        ctx.moveTo(-width / 2, y - 7); ctx.lineTo(-width / 2, y + 7);
        ctx.moveTo(width / 2, y - 7); ctx.lineTo(width / 2, y + 7);
        ctx.stroke();
        // the label stays upright: a rotated watch shouldn't tilt its own measurement
        ctx.save();
        ctx.translate(0, y + 31);
        ctx.rotate((-pose.angle * Math.PI) / 180);
        ctx.fillStyle = '#0A2237'; ctx.font = '19px "IBM Plex Sans Arabic", Arial, sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(measure(product.caseMm), 0, 0);
        ctx.restore();
      }
      ctx.restore();
    }
    // T68: the model's own fingers over a bag's handles (a layer of the same photo); a watch has none
    if (mode === 'model' && MODELS[model]?.front && images.current.front) ctx.drawImage(images.current.front, 0, 0, W, H);
    if (calibrating) {
      ctx.fillStyle = 'rgba(10,34,55,.2)'; ctx.fillRect(0, 0, W, H);
      points.forEach((p, i) => {
        ctx.beginPath(); ctx.arc(p.x, p.y, 10, 0, Math.PI * 2);
        ctx.fillStyle = '#fff'; ctx.fill(); ctx.strokeStyle = '#00A7BC'; ctx.lineWidth = 4; ctx.stroke();
        ctx.font = '24px Arial'; ctx.fillText(String(i + 1), p.x + 16, p.y - 12);
      });
    }
    ctx.restore();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assetsReady, mode, model, photo, pose, scale, zoom, ref, refPose, active, rulers, units, ar, calibrating, points, product.caseMm]);
  useEffect(() => redraw(), [redraw]);

  function getPoint(e: { clientX: number; clientY: number }) {
    const r = canvas.current!.getBoundingClientRect();
    const fit = expanded || mode !== 'model' ? Math.min(r.width / W, r.height / H) : Math.max(r.width / W, r.height / H);
    const ox = (r.width - W * fit) / 2, oy = (r.height - H * fit) / 2;
    return { x: ((e.clientX - r.left - ox) / fit - W / 2) / zoom + W / 2, y: ((e.clientY - r.top - oy) / fit - H / 2) / zoom + H / 2 };
  }
  function constrain(p: Pose): Pose {
    if (mode !== 'model') return { ...p, x: clamp(p.x, 50, W - 50), y: clamp(p.y, 50, H - 50) };
    return constrainToModel(MODELS[model].id as ModelId, p);
  }
  function pointerDown(e: React.PointerEvent<HTMLCanvasElement>) {
    if (mode === 'me' && !photo) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    gestures.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gestures.current.size === 2) {
      const [a, b] = [...gestures.current.values()];
      pinch.current = { distance: Math.hypot(a.x - b.x, a.y - b.y), zoom };
      drag.current = null;
      return;
    }
    const p = getPoint(e);
    if (calibrating) {
      if (points.length === 0) { setPoints([p]); return; }
      const a = points[0];
      const distance = Math.hypot(p.x - a.x, p.y - a.y);
      if (isRing) { // T68: the two sides of the ring finger, where the ring sits
        if (distance < 12) { notify(t('Tap the other side of your finger.', 'حدّد الجهة الأخرى من إصبعك.')); return; }
        const fit = { x: (a.x + p.x) / 2, y: (a.y + p.y) / 2, width: distance * 1.08, angle: (Math.atan2(p.y - a.y, p.x - a.x) * 180) / Math.PI };
        setPose(fit); setPhotoFit(fit); setScale(100); setCalibrating(false); setPoints([]);
        notify(t('Fit adjusted. You can still drag and rotate.', 'تم ضبط الخاتم. يمكنك تحريكه وتدويره.'));
        return;
      }
      if (isNecklace) { // T68: the pupils give the scale; the chin is about 1.68 pupil distances below them
        if (distance < 20) { notify(t('Tap the centre of your other eye.', 'حدّد منتصف عينك الأخرى.')); return; }
        const [l, r] = a.x <= p.x ? [a, p] : [p, a];
        const ipd = Math.hypot(r.x - l.x, r.y - l.y);
        const fit = necklacePose({ x: (l.x + r.x) / 2, y: (l.y + r.y) / 2 + ipd * 1.68 }, ipd);
        setPose(fit); setPhotoFit(fit); setScale(100); setCalibrating(false); setPoints([]);
        notify(t('Fit adjusted. You can still drag it.', 'تم ضبط القلادة. يمكنك تحريكها.'));
        return;
      }
      if (isGlasses) { // T68: the two pupils, 62 mm apart, give the photo's scale
        if (distance < 20) { notify(t('Tap the centre of your other eye.', 'حدّد منتصف عينك الأخرى.')); return; }
        const fit = glassesPose(a, p);
        setPose(fit); setPhotoFit(fit); setScale(100); setCalibrating(false); setPoints([]);
        notify(t('Fit adjusted. You can still drag and rotate.', 'تم ضبط النظارة. يمكنك تحريكها وتدويرها.'));
        return;
      }
      if (distance < 30) { notify(t('Choose the other edge of your wrist.', 'حدّد الحافة الأخرى من معصمك.')); return; }
      const w = images.current.watch;
      const base = {
        x: (a.x + p.x) / 2, y: (a.y + p.y) / 2,
        width: distance / (w.height / w.width),
        angle: (Math.atan2(p.y - a.y, p.x - a.x) * 180) / Math.PI - 90,
      };
      setPose(base); setPhotoFit(base); setScale(100); setCalibrating(false); setPoints([]);
      notify(t('Fit adjusted. You can still drag and rotate.', 'تم ضبط الساعة. يمكنك تحريكها وتدويرها.'));
      return;
    }
    let target: 'watch' | 'object' = 'watch';
    if (mode === 'compare' && Math.hypot(p.x - refPose.x, p.y - refPose.y) < Math.hypot(p.x - pose.x, p.y - pose.y)) target = 'object';
    setActive(target);
    drag.current = { ...p, start: target === 'watch' ? { ...pose } : { ...refPose, width: 0 }, target };
  }
  function pointerMove(e: React.PointerEvent<HTMLCanvasElement>) {
    if (gestures.current.has(e.pointerId)) gestures.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gestures.current.size === 2 && pinch.current) {
      const [a, b] = [...gestures.current.values()];
      setZoom(clamp((pinch.current.zoom * Math.hypot(a.x - b.x, a.y - b.y)) / pinch.current.distance, 0.65, 2.5));
      return;
    }
    const d = drag.current;
    if (!d) return;
    const p = getPoint(e);
    const next = { ...d.start, x: d.start.x + p.x - d.x, y: d.start.y + p.y - d.y };
    if (d.target === 'object') setRefPose({ x: clamp(next.x, 80, W - 80), y: clamp(next.y, 80, H - 80), angle: next.angle });
    else setPose(constrain(next));
  }
  function pointerEnd(e: React.PointerEvent<HTMLCanvasElement>) {
    gestures.current.delete(e.pointerId); drag.current = null; pinch.current = null;
  }
  function keyMove(e: React.KeyboardEvent) {
    const delta = e.shiftKey ? 15 : 5;
    const moves: Record<string, [number, number]> = { ArrowLeft: [-delta, 0], ArrowRight: [delta, 0], ArrowUp: [0, -delta], ArrowDown: [0, delta] };
    if (!moves[e.key]) return;
    e.preventDefault();
    const [x, y] = moves[e.key];
    if (mode === 'compare' && active === 'object') setRefPose((p) => ({ ...p, x: clamp(p.x + x, 80, W - 80), y: clamp(p.y + y, 80, H - 80) }));
    else setPose((p) => constrain({ ...p, x: p.x + x, y: p.y + y }));
  }

  /**
   * T68 — glasses on a face from the two pupils (stage coordinates, either order): an adult's are about
   * 62 mm apart, so the frame is drawn at its width on that scale, centred between them a touch lower
   * (the frame's centre sits just below the pupils), tilted as the eyes are.
   */
  function glassesPose(a: { x: number; y: number }, b: { x: number; y: number }): Pose {
    const [l, r] = a.x <= b.x ? [a, b] : [b, a];
    const ipd = Math.hypot(r.x - l.x, r.y - l.y);
    return {
      x: clamp((l.x + r.x) / 2, 50, W - 50), y: clamp((l.y + r.y) / 2 + ipd * 0.025, 50, H - 50),
      width: clamp((product.caseMm * ipd) / 62, 80, 1100),
      angle: (Math.atan2(r.y - l.y, r.x - l.x) * 180) / Math.PI,
    };
  }

  /**
   * T68 — a necklace from the chin and the pupils (stage coordinates): drawn at its width on the pupils'
   * scale (62 mm apart), hanging straight, its chains starting about 9.6 mm below the chin — as on the
   * model photo it was measured on.
   */
  function necklacePose(chin: { x: number; y: number }, ipd: number): Pose {
    const pxPerMm = ipd / 62;
    const width = clamp(product.caseMm * pxPerMm, 60, 1100);
    const w = images.current.watch;
    const height = w ? (width * w.height) / w.width : width;
    return { x: clamp(chin.x, 50, W - 50), y: clamp(chin.y + 9.6 * pxPerMm + height / 2, 50, H - 50), width, angle: 0 };
  }

  /** T68 — find the face in the shopper's photo (on this device) and place the glasses on it. */
  async function fitGlassesToFace(img: HTMLImageElement, request: number) {
    try {
      if (!faceDetector.current) {
        const { FilesetResolver, FaceLandmarker } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks(asset('/wasm'));
        faceDetector.current = await FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: asset('/assets/face-landmarker.task'), delegate: 'CPU' },
          runningMode: 'IMAGE', numFaces: 1, minFaceDetectionConfidence: 0.4,
        });
      }
      const result = faceDetector.current.detect(img);
      if (request !== photoRequest.current) return;
      const lm = result.faceLandmarks?.[0];
      if (lm && lm[468] && lm[473]) { // the two iris centres
        const f = Math.min(W / img.width, H / img.height);
        const ox = (W - img.width * f) / 2, oy = (H - img.height * f) / 2;
        const at = (i: number) => ({ x: lm[i].x * img.width * f + ox, y: lm[i].y * img.height * f + oy });
        const fit = isNecklace && lm[152]
          ? necklacePose(at(152), Math.hypot(at(473).x - at(468).x, at(473).y - at(468).y))
          : glassesPose(at(468), at(473));
        setPose(fit); setPhotoFit(fit);
        notify(isNecklace ? t('Face found. Fine-tune the fit if needed.', 'تم تحديد الوجه. عدّل موضع القلادة عند الحاجة.') : t('Face found. Fine-tune the fit if needed.', 'تم تحديد الوجه. عدّل موضع النظارة عند الحاجة.'));
      } else notify(t('Face not found. Use “Fit to eyes” to place the glasses.', 'لم يتم تحديد الوجه. استخدم «ضبط على العينين».'));
    } catch {
      notify(t('Use “Fit to eyes” to place the glasses on the photo.', 'استخدم «ضبط على العينين» لتحديد موضع النظارة.'));
    }
  }

  /**
   * T68 — a ring on the shopper's own hand (found on their device, the same model as the wrist): on the
   * ring finger between its base and middle joints, across the finger, sized from the knuckles — the
   * index and little fingers' base joints are about 62 mm apart in an adult's hand.
   */
  async function fitRingToHand(img: HTMLImageElement, request: number) {
    try {
      if (!handDetector.current) {
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks(asset('/wasm'));
        handDetector.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: asset('/assets/hand-landmarker.task'), delegate: 'CPU' },
          runningMode: 'IMAGE', numHands: 1, minHandDetectionConfidence: 0.35,
        });
      }
      const result = handDetector.current.detect(img);
      if (request !== photoRequest.current) return;
      const lm = result.landmarks?.[0];
      if (lm) {
        const f = Math.min(W / img.width, H / img.height);
        const ox = (W - img.width * f) / 2, oy = (H - img.height * f) / 2;
        const at = (i: number) => ({ x: lm[i].x * img.width * f + ox, y: lm[i].y * img.height * f + oy });
        const base = at(13), middle = at(14), index = at(5), little = at(17);
        const pxPerMm = Math.hypot(index.x - little.x, index.y - little.y) / 62;
        const dx = middle.x - base.x, dy = middle.y - base.y;
        const fit = {
          x: clamp(base.x + dx * 0.4, 50, W - 50), y: clamp(base.y + dy * 0.4, 50, H - 50),
          width: clamp(product.caseMm * pxPerMm, 30, 400),
          angle: (Math.atan2(dx, -dy) * 180) / Math.PI, // the band across the finger
        };
        setPose(fit); setPhotoFit(fit);
        notify(t('Hand found. Fine-tune the fit if needed.', 'تم تحديد اليد. عدّل موضع الخاتم عند الحاجة.'));
      } else notify(t('Hand not found. Use “Fit to finger” to place the ring.', 'لم يتم تحديد اليد. استخدم «ضبط على الإصبع».'));
    } catch {
      notify(t('Use “Fit to finger” to place the ring on the photo.', 'استخدم «ضبط على الإصبع» لتحديد موضع الخاتم.'));
    }
  }

  async function applyPhoto(blob: Blob) {
    const request = ++photoRequest.current;
    setPhotoBusy(true);
    try {
      const prepared = await preparePhoto(blob);
      const img = await loadImage(prepared.dataUrl);
      if (request !== photoRequest.current) return;
      images.current.photo = img;
      setPhoto(prepared.dataUrl); setMode('me'); setZoom(1); setScale(100); setCalibrating(false);
      let base = { x: 600, y: 570, width: 155, angle: 0 };
      setPose(base); setPhotoFit(base);
      if (isGlasses || isNecklace) { await fitGlassesToFace(img, request); return; } // T68; a watch, as before:
      if (isRing) { await fitRingToHand(img, request); return; }
      try {
        if (!handDetector.current) {
          const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
          const vision = await FilesetResolver.forVisionTasks(asset('/wasm'));
          handDetector.current = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: asset('/assets/hand-landmarker.task'), delegate: 'CPU' },
            runningMode: 'IMAGE', numHands: 1, minHandDetectionConfidence: 0.35,
          });
        }
        const result = handDetector.current.detect(img);
        if (request !== photoRequest.current) return;
        if (result.landmarks.length) {
          const lm = result.landmarks[0];
          const f = Math.min(W / img.width, H / img.height);
          const ox = (W - img.width * f) / 2, oy = (H - img.height * f) / 2;
          const wrist = { x: lm[0].x * img.width * f + ox, y: lm[0].y * img.height * f + oy };
          const middle = { x: lm[9].x * img.width * f + ox, y: lm[9].y * img.height * f + oy };
          const dx = middle.x - wrist.x, dy = middle.y - wrist.y;
          const palm = Math.hypot((lm[5].x - lm[17].x) * img.width * f, (lm[5].y - lm[17].y) * img.height * f);
          const w = images.current.watch;
          base = {
            x: clamp(wrist.x - dx * 0.22, 50, W - 50), y: clamp(wrist.y - dy * 0.22, 50, H - 50),
            width: clamp((palm * 0.9) / (w.height / w.width), 45, 240),
            angle: (Math.atan2(dy, dx) * 180) / Math.PI,
          };
          setPose(base); setPhotoFit(base);
          notify(t('Wrist found. Fine-tune the fit if needed.', 'تم تحديد المعصم. عدّل موضع الساعة عند الحاجة.'));
        } else notify(t('Wrist not found. Use “Fit to wrist” to place your watch.', 'لم يتم تحديد المعصم. استخدم «ضبط على المعصم».'));
      } catch {
        notify(t('Use “Fit to wrist” to place your watch on the photo.', 'استخدم «ضبط على المعصم» لتحديد موضع الساعة.'));
      }
    } catch {
      notify(t('This image could not be opened. Choose a JPG, PNG or WebP.', 'تعذر فتح الصورة. اختر JPG أو PNG أو WebP.'));
    } finally {
      if (request === photoRequest.current) setPhotoBusy(false);
    }
  }

  async function startPair() {
    setPairBusy(true); setPairError('');
    try {
      const r = await fetch('/api/pair', { method: 'POST' });
      if (!r.ok) throw Error();
      const p = (await r.json()) as { id: string; expiresAt: number };
      setPair(p);
      setQrImage(await QRCode.toDataURL(`${window.location.origin}/capture/${p.id}`, { margin: 2, width: 240, color: { dark: '#0A2237', light: '#ffffff' } }));
    } catch {
      setPairError(t('Could not connect. Try again or upload a photo here.', 'تعذر الاتصال. حاول مجدداً أو ارفع الصورة هنا.'));
    } finally { setPairBusy(false); }
  }
  useEffect(() => { if (qrOpen && !pair && !pairBusy && !pairError) void startPair(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [qrOpen, pair, pairBusy, pairError]);
  useEffect(() => {
    if (!qrOpen || !pair) return;
    let disposed = false, pending = false;
    const timer = setInterval(async () => {
      if (disposed || pending) return;
      pending = true;
      try {
        if (Date.now() > pair.expiresAt) {
          setPairError(t('This QR code has expired. Create a new one.', 'انتهت صلاحية الرمز. أنشئ رمزاً جديداً.'));
          clearInterval(timer); return;
        }
        const r = await fetch(`/api/pair/${pair.id}`, { cache: 'no-store' });
        if (!r.ok) throw Error();
        const data = (await r.json()) as { ready: boolean };
        if (data.ready) {
          clearInterval(timer);
          const photoResponse = await fetch(`/api/pair/${pair.id}?image=1`, { cache: 'no-store' });
          if (!photoResponse.ok) throw Error();
          const b = await photoResponse.blob();
          if (disposed) return;
          setQrOpen(false); setPair(null); setQrImage('');
          void fetch(`/api/pair/${pair.id}`, { method: 'DELETE' });
          await applyPhoto(b);
        }
      } catch {
        if (!disposed) setPairError(t('Connection interrupted. Try a new QR code.', 'انقطع الاتصال. جرّب رمزاً جديداً.'));
      } finally { pending = false; }
    }, 2500);
    return () => { disposed = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qrOpen, pair, ar]);
  function closePair(open: boolean) {
    setQrOpen(open);
    if (!open && pair) { void fetch(`/api/pair/${pair.id}`, { method: 'DELETE' }); setPair(null); setQrImage(''); setPairError(''); }
  }
  function saveImage() {
    if (!canvas.current) return;
    try {
      const link = document.createElement('a');
      link.download = 'tajribah-try-on.png';
      link.href = canvas.current.toDataURL('image/png');
      link.click();
      notify(t('Your image is ready.', 'صورتك جاهزة.'));
    } catch { notify(t('Could not save the image. Please try again.', 'تعذر حفظ الصورة. حاول مجدداً.')); }
  }

  // Browser agent tools (WebMCP) drive the same state the controls do.
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const context = (document as any).modelContext;
    if (!context?.registerTool) return;
    const life = new AbortController();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const register = (tool: any) => { try { Promise.resolve(context.registerTool(tool, { signal: life.signal })).catch(() => {}); } catch { /* optional API */ } };
    register({
      name: 'configure_try_on', title: 'Configure try-on',
      description: 'Switch the visible try-on mode and model photo or comparison object.',
      inputSchema: { type: 'object', properties: {
        mode: { type: 'string', enum: ['model', 'me', 'compare'] },
        model: { type: 'integer', enum: [0, 1] },
        reference: { type: 'string', enum: REF_IDS },
      }, required: ['mode'], additionalProperties: false },
      annotations: { readOnlyHint: false },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      execute: async (input: any) => {
        if (!input || !['model', 'me', 'compare'].includes(input.mode)
          || ('model' in input && ![0, 1].includes(input.model))
          || ('reference' in input && !REF_IDS.includes(input.reference))) throw Error('Invalid try-on configuration');
        setMode(input.mode);
        if (input.model !== undefined) setModel(input.model);
        if (input.reference) setRef(input.reference);
        reset(input.mode, input.model ?? model);
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        return { mode: input.mode, model: input.model ?? model, reference: input.reference ?? ref };
      },
    });
    register({
      name: 'get_try_on_state', title: 'Read try-on state',
      description: 'Read the currently displayed mode, dimensions, model and adjustments.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true },
      execute: () => ({ mode, model, reference: ref, zoom, scale, pose, units, hasPhoto: !!photo }),
    });
    return () => life.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, model, ref, zoom, scale, pose, units, photo]);

  const showCanvas = mode !== 'me' || !!photo;

  return (
    <div className={'studio-root ' + (expanded ? 'is-expanded' : '')}>
      <div className="studio-layout">
        <aside className="product-panel">
          {product.demo && <div className="demo-badge"><span className="dot" />{t('Demo store · Failet (example)', 'متجر تجريبي · فايلت (مثال)')}</div>}
          <div className="eyebrow">{t(product.collection.en, product.collection.ar)}</div>
          <h1>{t(product.headLead.en, product.headLead.ar)}<br /><em>{t(product.headEm.en, product.headEm.ar)}</em></h1>
          <p className="product-name">{t(product.name.en, product.name.ar)}</p>
          <p className="finish-name"><span className="finish-dot" />{t(product.finish.en, product.finish.ar)}</p>
          <div className={isGlasses ? 'product-image product-image-wide' : 'product-image'}>
            <img src={asset(product.worn)} alt={t(product.alt.en, product.alt.ar)} />
          </div>
          <div className="product-detail"><span>{t('Reference', 'رقم المنتج')}</span><strong dir="ltr">{product.sku}</strong></div>
          <div className="product-detail"><span>{isEarring ? t('Approx. earring width', 'عرض القرط التقريبي') : isBag ? t('Approx. width', 'العرض التقريبي') : isNecklace ? t('Approx. width at the neck', 'العرض التقريبي عند الرقبة') : isRing ? t('Approx. ring width', 'عرض الخاتم التقريبي') : isGlasses ? t('Approx. frame width', 'عرض الإطار التقريبي') : t('Approx. case width', 'عرض العلبة التقريبي')}</span><strong dir="ltr">{measure(product.caseMm)}</strong></div>
          {product.storeLink && (
            <a href={product.storeLink.href} className="store-link" target="_blank" rel="noreferrer">
              {t(product.storeLink.label.en, product.storeLink.label.ar)}<ChevronRight size={16} />
            </a>
          )}
          {product.demo && (
            <p className="product-note">
              {t('Failet is an independent brand. It appears here only as an example store, and this demo does not imply a partnership.',
                'فايلت علامة تجارية مستقلة، تظهر هنا مثالًا لمتجر فقط، ولا يعني هذا العرض وجود شراكة أو اعتماد.')}
            </p>
          )}
        </aside>

        <section className="studio-panel" aria-label={isEarring ? t('Earring try-on studio', 'استوديو تجربة القرط') : isBag ? t('Bag try-on studio', 'استوديو تجربة الحقيبة') : isNecklace ? t('Necklace try-on studio', 'استوديو تجربة القلادة') : isRing ? t('Ring try-on studio', 'استوديو تجربة الخاتم') : isGlasses ? t('Glasses try-on studio', 'استوديو تجربة النظارة') : t('Watch try-on studio', 'استوديو تجربة الساعة')}>
          <div className="studio-topbar">
            <Tabs value={mode} onValueChange={changeMode}>
              <TabsList className="mode-tabs">
                <TabsTrigger value="model" aria-controls={undefined}><Hand size={17} />{t('On model', 'على النموذج')}</TabsTrigger>
                {product.onMe !== false && <TabsTrigger value="me" aria-controls={undefined}><Camera size={17} />{t('On me', 'عليّ')}</TabsTrigger>}
                <TabsTrigger value="compare" aria-controls={undefined}><Ruler size={17} />{t('Compare', 'قارن الحجم')}</TabsTrigger>
              </TabsList>
            </Tabs>
            <div className="topbar-actions">
              <button className="icon-button" aria-label={t('How it works', 'طريقة الاستخدام')} onClick={() => setHelpOpen(true)}><HelpCircle size={18} /></button>
              <button className="icon-button" aria-label={expanded ? t('Exit expanded view', 'إغلاق العرض الموسع') : t('Expand studio', 'توسيع الاستوديو')} onClick={() => setExpanded(!expanded)}>{expanded ? <X size={18} /> : <Expand size={18} />}</button>
            </div>
          </div>

          <div className={'stage ' + (mode !== 'model' ? 'compare-stage' : '')}>
            {showCanvas ? (
              <>
                <div className="stage-label"><span className="label-line" />
                  {mode === 'model' ? t(MODELS[model].stageLabel.en, MODELS[model].stageLabel.ar)
                    : mode === 'compare' ? t('Size in perspective', 'الحجم عن قرب')
                      : t('Your personal try-on', 'تجربتك الخاصة')}
                </div>
                <canvas ref={canvas} width={W} height={H} tabIndex={0}
                  aria-label={isEarring ? t('Interactive earring preview. Drag to position. Use arrow keys for precise movement.', 'معاينة القرط. اسحب لتغيير موضعه أو استخدم مفاتيح الأسهم.') : isBag ? t('Interactive bag preview. Use arrow keys for precise movement.', 'معاينة الحقيبة. استخدم مفاتيح الأسهم لتحريكها بدقة.') : isNecklace ? t('Interactive necklace preview. Drag to position. Use arrow keys for precise movement.', 'معاينة القلادة. اسحب لتغيير موضعها أو استخدم مفاتيح الأسهم.') : isRing ? t('Interactive ring preview. Drag to position. Use arrow keys for precise movement.', 'معاينة الخاتم. اسحب لتغيير موضعه أو استخدم مفاتيح الأسهم.') : isGlasses ? t('Interactive glasses preview. Drag to position. Use arrow keys for precise movement.', 'معاينة النظارة. اسحب لتغيير موضعها أو استخدم مفاتيح الأسهم.') : t('Interactive watch preview. Drag to position. Use arrow keys for precise movement.', 'معاينة الساعة. اسحب لتغيير موضعها أو استخدم مفاتيح الأسهم.')}
                  onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}
                  onLostPointerCapture={pointerEnd} onKeyDown={keyMove} className={calibrating ? 'calibrating' : ''} />
                {!assetsReady && (
                  <div className="stage-loading">
                    {assetError ? (<><span>{t('Images could not load.', 'تعذر تحميل الصور.')}</span>
                      <button className="text-button" onClick={() => window.location.reload()}>{t('Reload', 'إعادة التحميل')}</button></>)
                      : <LoaderCircle className="spin" />}
                  </div>
                )}
                {photoBusy && <div className="detecting"><LoaderCircle size={16} className="spin" />{isNecklace ? t('Finding your face…', 'جارٍ تحديد الوجه…') : isRing ? t('Finding your hand…', 'جارٍ تحديد اليد…') : isGlasses ? t('Finding your face…', 'جارٍ تحديد الوجه…') : t('Finding your wrist…', 'جارٍ تحديد المعصم…')}</div>}
                {calibrating && (
                  <div className="calibration-prompt">
                    <span>{isNecklace ? (points.length ? t('2. Tap the centre of your other eye', '٢. حدّد منتصف عينك الأخرى') : t('1. Tap the centre of one eye', '١. حدّد منتصف إحدى عينيك')) : isRing ? (points.length ? t('2. Tap the other side of your ring finger', '٢. حدّد الجهة الأخرى من البنصر') : t('1. Tap one side of your ring finger, where the ring sits', '١. حدّد جهة من البنصر حيث يُلبس الخاتم')) : isGlasses ? (points.length ? t('2. Tap the centre of your other eye', '٢. حدّد منتصف عينك الأخرى') : t('1. Tap the centre of one eye', '١. حدّد منتصف إحدى عينيك')) : points.length ? t('2. Tap the opposite edge of your wrist', '٢. حدد الحافة المقابلة من المعصم') : t('1. Tap one edge of your wrist', '١. حدد إحدى حافتي المعصم')}</span>
                    <button aria-label={t('Cancel fitting', 'إلغاء الضبط')} onClick={() => { setCalibrating(false); setPoints([]); }}><X size={16} /></button>
                  </div>
                )}
                <div className="canvas-tools">
                  <button aria-label={t('Zoom out', 'تصغير')} onClick={() => setZoom((z) => clamp(z - 0.15, 0.65, 2.5))}><Minus size={17} /></button>
                  <span dir="ltr">{Math.round(zoom * 100)}%</span>
                  <button aria-label={t('Zoom in', 'تكبير')} onClick={() => setZoom((z) => clamp(z + 0.15, 0.65, 2.5))}><Plus size={17} /></button>
                  <span className="tool-divider" />
                  <button aria-label={t('Reset view', 'إعادة ضبط العرض')} onClick={() => reset()}><RotateCcw size={16} /></button>
                </div>
                <div className="drag-hint"><Move size={13} />{t('Drag to find your fit', 'اسحب لضبط الموضع')}</div>
              </>
            ) : (
              <div className="personal-empty">
                <div className="photo-icon"><Camera size={31} strokeWidth={1.3} /></div>
                <span className="eyebrow">{t('Make it personal', 'جرّبها بنفسك')}</span>
                <h2>{isNecklace ? t('You. Your necklace.', 'أنتِ. قلادتك.') : isRing ? t('Your hand. Your ring.', 'يدك. خاتمك.') : isGlasses ? t('Your face. Your frame.', 'وجهك. إطارك.') : t('Your wrist. Your watch.', 'معصمك. ساعتك.')}</h2>
                <p>{isNecklace ? t('See how it looks on you with a front photo, your face and chest in view. It stays on this device.', 'شاهدي كيف تبدو القلادة عليك بصورة أمامية يظهر فيها الوجه والصدر. تبقى الصورة على جهازك.') : isRing ? t('See how it looks on you with a photo of the back of your hand, fingers apart. It stays on this device.', 'شاهد كيف يبدو الخاتم عليك بصورة لظهر يدك والأصابع متباعدة. تبقى الصورة على جهازك.') : isGlasses ? t('See how it looks on you with a front photo of your face. It stays on this device.', 'شاهد كيف تبدو النظارة عليك بصورة أمامية لوجهك. تبقى الصورة على جهازك.') : t('See how it looks on you with a photo of your wrist.', 'شاهد كيف تبدو الساعة عليك باستخدام صورة لمعصمك.')}</p>
                <button className="primary-button" onClick={() => (isPhone ? file.current?.click() : features.pairing ? setQrOpen(true) : file.current?.click())}>
                  {isPhone ? <Camera size={18} /> : features.pairing ? <Smartphone size={18} /> : <Upload size={18} />}
                  {isPhone ? (isNecklace ? t('Take a front photo', 'التقطي صورة أمامية') : isRing ? t('Take a photo of your hand', 'التقط صورة ليدك') : isGlasses ? t('Take a selfie', 'التقط صورة لوجهك') : t('Take a wrist photo', 'التقط صورة لمعصمك'))
                    : features.pairing ? t('Continue on your phone', 'أكمل التجربة من جوالك')
                      : isNecklace ? t('Upload a front photo', 'ارفعي صورة أمامية') : isRing ? t('Upload a hand photo', 'ارفع صورة ليدك') : isGlasses ? t('Upload a face photo', 'ارفع صورة لوجهك') : t('Upload a wrist photo', 'ارفع صورة لمعصمك')}
                </button>
                {(isPhone || features.pairing) && (
                  <button className="text-button" onClick={() => file.current?.click()}><Upload size={16} />{t('Or upload a photo', 'أو ارفع صورة')}</button>
                )}
                <p className="privacy-note">{t('Photos uploaded here stay in this browser.', 'الصور المرفوعة هنا تبقى في هذا المتصفح.')}</p>
              </div>
            )}
          </div>

          <div className="studio-bottom">
            <div className="selection-row">
              {mode === 'model' ? (
                <>
                  <div className="section-caption">{t('Choose your view', 'اختر طريقة العرض')}</div>
                  <div className="model-options">
                    {MODELS.map((m, n) => (
                      <button key={m.id} onClick={() => changeModel(n)} className={'model-option ' + (model === n ? 'selected' : '')} aria-pressed={model === n}>
                        <img src={asset(m.thumb)} alt="" />
                        <span>{t(m.label.en, m.label.ar)}</span>
                        {model === n && <Check size={14} />}
                      </button>
                    ))}
                  </div>
                </>
              ) : mode === 'compare' ? (
                <>
                  <div className="section-caption">{t('Compare with', 'قارن مع')}</div>
                  <div className="reference-options">
                    {REF_IDS.map((n) => (
                      <button className={'reference-option ' + (ref === n ? 'selected' : '')} key={n} aria-pressed={ref === n}
                        onClick={() => { setRef(n); setRefPose({ x: refStartX(), y: 550, angle: 0 }); }}>
                        <img src={asset(REFERENCES[n].src)} alt="" /><span>{t(REFERENCES[n].name.en, REFERENCES[n].name.ar)}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="photo-actions">
                  <button className="secondary-button" onClick={() => file.current?.click()}><ImagePlus size={16} />{photo ? t('Change photo', 'تغيير الصورة') : t('Upload a photo', 'ارفع صورة')}</button>
                  {photo && <button className="secondary-button" onClick={() => { setCalibrating(true); setPoints([]); setZoom(1); }}><Maximize2 size={16} />{isNecklace ? t('Fit to eyes', 'ضبط على العينين') : isRing ? t('Fit to finger', 'ضبط على الإصبع') : isGlasses ? t('Fit to eyes', 'ضبط على العينين') : t('Fit to wrist', 'ضبط على المعصم')}</button>}
                  {features.pairing && <button className="icon-button" aria-label={t('Use your phone', 'استخدام الجوال')} onClick={() => setQrOpen(true)}><QrCode size={19} /></button>}
                </div>
              )}
            </div>
            {showCanvas && (
              <div className="adjustments">
                <div className="adjustment">
                  <div className="adjustment-label"><label id="rotation-label">{mode === 'compare' && active === 'object' ? t('Object rotation', 'تدوير العنصر') : t('Rotation', 'التدوير')}</label>
                    <span dir="ltr">{Math.round(active === 'object' && mode === 'compare' ? refPose.angle : pose.angle)}°</span></div>
                  <Slider aria-labelledby="rotation-label" value={[active === 'object' && mode === 'compare' ? refPose.angle : pose.angle]} min={-180} max={180} step={1}
                    onValueChange={([angle]) => (active === 'object' && mode === 'compare' ? setRefPose((p) => ({ ...p, angle })) : setPose((p) => ({ ...p, angle })))} />
                </div>
                {mode !== 'compare' && (
                  <div className="adjustment">
                    <div className="adjustment-label"><label id="scale-label">{isEarring ? t('Earring size', 'حجم القرط') : isBag ? t('Bag size', 'حجم الحقيبة') : isNecklace ? t('Necklace size', 'حجم القلادة') : isRing ? t('Ring size', 'حجم الخاتم') : isGlasses ? t('Glasses size', 'حجم النظارة') : t('Watch size', 'حجم الساعة')}</label><span dir="ltr">{scale}%</span></div>
                    <Slider aria-labelledby="scale-label" value={[scale]} min={50} max={160} step={1} onValueChange={([v]) => setScale(v)} />
                  </div>
                )}
                <div className="measurement-control">
                  <label htmlFor="dimensions">{t('Measurements', 'المقاسات')}</label>
                  <Switch id="dimensions" checked={rulers} onCheckedChange={setRulers} />
                  <Select value={units} onValueChange={setUnits}>
                    <SelectTrigger aria-label={t('Measurement units', 'وحدة القياس')} className="unit-select"><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="mm">{t('mm', 'مم')}</SelectItem><SelectItem value="in">{t('in', 'بوصة')}</SelectItem></SelectContent>
                  </Select>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>

      <footer className="studio-footer">
        <span><Ruler size={15} />{isEarring ? t('A visual guide to size. Dimensions and placement are approximate.', 'دليل مرئي للحجم. الأبعاد وموضع القرط تقريبيان.') : isBag ? t('A visual guide to size. Dimensions and placement are approximate.', 'دليل مرئي للحجم. الأبعاد وموضع الحقيبة تقريبيان.') : isNecklace ? t('A visual guide to fit. Dimensions and placement are approximate.', 'دليل مرئي للمقاس. الأبعاد وموضع القلادة تقريبيان.') : isRing ? t('A visual guide to fit. Dimensions and placement are approximate.', 'دليل مرئي للمقاس. الأبعاد وموضع الخاتم تقريبيان.') : isGlasses ? t('A visual guide to fit. Dimensions and placement are approximate.', 'دليل مرئي للمقاس. الأبعاد وموضع النظارة تقريبيان.') : t('A visual guide to fit. Dimensions and placement are approximate.', 'دليل مرئي للمقاس. الأبعاد وموضع الساعة تقريبيان.')}</span>
        {showCanvas && features.download && (
          <button className="download-button" onClick={saveImage} disabled={!assetsReady || photoBusy}><Download size={16} />{t('Save your look', 'احفظ إطلالتك')}</button>
        )}
      </footer>

      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture={isPhone ? 'environment' : undefined}
        className="sr-only" aria-label={isNecklace ? t('Choose a front photo', 'اختاري صورة أمامية') : isRing ? t('Choose hand photo', 'اختر صورة اليد') : isGlasses ? t('Choose face photo', 'اختر صورة الوجه') : t('Choose wrist photo', 'اختر صورة المعصم')}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void applyPhoto(f); e.target.value = ''; }} />

      {features.pairing && (
        <Dialog open={qrOpen} onOpenChange={closePair}>
          <DialogContent className="qr-dialog">
            <DialogTitle>{t('Take your try-on to your phone', 'أكمل التجربة على جوالك')}</DialogTitle>
            <DialogDescription>{isNecklace ? t('Scan the code with your phone camera. Take a front photo and send it to this studio.', 'امسحي الرمز بكاميرا جوالك، ثم التقطي صورة أمامية وأرسليها إلى الاستوديو.') : isRing ? t('Scan the code with your phone camera. Take a photo of your hand and send it to this studio.', 'امسح الرمز بكاميرا جوالك، ثم التقط صورة ليدك وأرسلها إلى الاستوديو.') : isGlasses ? t('Scan the code with your phone camera. Take a selfie and send it to this studio.', 'امسح الرمز بكاميرا جوالك، ثم التقط صورة لوجهك وأرسلها إلى الاستوديو.') : t('Scan the code with your phone camera. Take a wrist photo and send it to this studio.', 'امسح الرمز بكاميرا جوالك، ثم التقط صورة لمعصمك وأرسلها إلى الاستوديو.')}</DialogDescription>
            <div className="qr-box">
              {pairBusy ? <LoaderCircle className="spin" /> : pairError ? <p>{pairError}</p> : qrImage ? <img src={qrImage} alt={isGlasses || isRing || isNecklace ? t('Scan to send your photo', 'امسح الرمز لإرسال صورتك') : t('Scan to send your wrist photo', 'امسح الرمز لإرسال صورة معصمك')} /> : <LoaderCircle className="spin" />}
            </div>
            {pairError ? (
              <button className="primary-button" onClick={() => { if (pair) void fetch(`/api/pair/${pair.id}`, { method: 'DELETE' }); setPair(null); void startPair(); }}>{t('Create a new code', 'إنشاء رمز جديد')}</button>
            ) : (
              <p className="qr-status"><LoaderCircle size={14} className="spin" />{t('Waiting for your photo', 'بانتظار صورتك')}</p>
            )}
            {pair && !pairError && <a className="text-button" href={`/capture/${pair.id}`} target="_blank" rel="noreferrer">{t('Open capture page', 'فتح صفحة التصوير')}</a>}
            <p className="privacy-note">{t('Valid for 30 minutes. The transferred photo is removed after this browser receives it.', 'صالح لمدة ٣٠ دقيقة. تُحذف الصورة المنقولة بعد استلامها هنا.')}</p>
          </DialogContent>
        </Dialog>
      )}

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        <DialogContent>
          <DialogTitle>{isEarring ? t('A closer look', 'طرق تجربة قرطك') : isBag ? t('A closer look', 'طرق تجربة حقيبتك') : isNecklace ? t('A closer look', 'طرق تجربة قلادتك') : isRing ? t('A closer look', 'طرق تجربة خاتمك') : isGlasses ? t('A closer look', 'طرق تجربة نظارتك') : t('A closer look, in three ways', 'ثلاث طرق لتجربة ساعتك')}</DialogTitle>
          <DialogDescription>{isEarring ? t('Explore the earring from every perspective.', 'اكتشف القرط بالطريقة التي تناسبك.') : isBag ? t('Explore the bag from every perspective.', 'اكتشف الحقيبة بالطريقة التي تناسبك.') : isNecklace ? t('Explore the necklace from every perspective.', 'اكتشف القلادة بالطريقة التي تناسبك.') : isRing ? t('Explore the ring from every perspective.', 'اكتشف الخاتم بالطريقة التي تناسبك.') : isGlasses ? t('Explore the glasses from every perspective.', 'اكتشف النظارة بالطريقة التي تناسبك.') : t('Explore the watch from every perspective.', 'اكتشف الساعة بالطريقة التي تناسبك.')}</DialogDescription>
          <div className="help-steps">
            <div><Hand /><div><strong>{t('On model', 'على النموذج')}</strong><p>{isEarring ? t('The earring hangs from a real ear at its real size. Drag it and adjust its size.', 'يتدلى القرط من أذن حقيقية بحجمه الحقيقي. حرّكه وعدّل حجمه.') : isBag ? t('The bag is carried by a real model at its real size.', 'تحمل الحقيبةَ عارضةٌ حقيقية بحجمها الحقيقي.') : isNecklace ? t('The necklace hangs on a real model at its real size. Drag it and adjust its size.', 'تتدلى القلادة على عارضة حقيقية بحجمها الحقيقي. حرّكها وعدّل حجمها.') : isRing ? t('The ring sits on a real hand at its real width. Drag it along the finger and adjust its size or angle.', 'يظهر الخاتم على يد حقيقية بعرضه الحقيقي. حرّكه على الإصبع وعدّل حجمه وزاويته.') : isGlasses ? t('The frame sits on a real face at its real width. Drag it and adjust its size or angle.', 'يظهر الإطار على وجه حقيقي بعرضه الحقيقي. حرّكه وعدّل حجمه وزاويته.') : t('Choose a close-up or lifestyle photo. Drag the watch along the wrist and adjust its size or angle.', 'اختر صورة المعصم أو الإطلالة اليومية. حرّك الساعة على المعصم وعدّل حجمها وزاويتها.')}</p></div></div>
            <div><Camera /><div><strong>{t('On me', 'عليّ')}</strong><p>{isNecklace ? t('Upload a clear front photo with your face and chest in view. We find your face automatically, on this device, and hang the necklace below your chin; use Fit to eyes to tap your two pupils if needed.', 'ارفعي صورة أمامية واضحة يظهر فيها الوجه والصدر. نحدد وجهك تلقائيًا على جهازك ونعلّق القلادة تحت الذقن، ويمكنك تحديد الحدقتين باستخدام ضبط على العينين.') : isRing ? t('Upload a clear photo of the back of your hand, fingers apart. We find your ring finger automatically, on this device; use Fit to finger to tap its two sides if needed.', 'ارفع صورة واضحة لظهر يدك والأصابع متباعدة. نحدد البنصر تلقائيًا على جهازك، ويمكنك تحديد جهتيه باستخدام ضبط على الإصبع.') : isGlasses ? t('Upload a clear front photo of your face. We find your eyes automatically, on this device; use Fit to eyes to tap your two pupils if needed.', 'ارفع صورة أمامية واضحة لوجهك. نحدد عينيك تلقائيًا على جهازك، ويمكنك تحديد الحدقتين باستخدام ضبط على العينين.') : t('Upload a clear photo with your whole hand visible. We look for your wrist automatically; use Fit to wrist to mark its two edges if needed.', 'ارفع صورة واضحة تظهر اليد كاملة. نحاول تحديد المعصم تلقائياً، ويمكنك تحديد حافتيه باستخدام ضبط على المعصم.')}</p></div></div>
            <div><Ruler /><div><strong>{t('Compare', 'قارن الحجم')}</strong><p>{t('Compare relative sizes with an iPhone, AirPods or Saudi riyal. Drag either item and rotate it. Zoom scales both together.', 'قارن الحجم مع آيفون أو إيربودز أو ريال سعودي. حرّك أي عنصر ودوّره. التكبير يغيّر حجم العنصرين معاً.')}</p></div></div>
            <p className="privacy-note">{t('Photo-based preview, not a live 3D camera filter. A single photo cannot verify exact physical fit.', 'معاينة باستخدام صورة، وليست فلتر كاميرا ثلاثي الأبعاد. لا يمكن التحقق من المقاس الفعلي الدقيق عبر صورة واحدة.')}</p>
          </div>
        </DialogContent>
      </Dialog>

      {notice && (
        <div className="notice" role="status">{notice}
          <button aria-label={t('Dismiss notification', 'إغلاق التنبيه')} onClick={() => setNotice('')}><X size={15} /></button>
        </div>
      )}
    </div>
  );
}
