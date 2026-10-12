'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera, Check, ChevronRight, Columns2, Download, Expand, ExternalLink, Hand, HelpCircle, ImagePlus, LoaderCircle,
  Maximize2, Minus, Move, Plus, QrCode, RotateCcw, RotateCw, Ruler, Scaling, Share2, Smartphone, Upload, X,
} from 'lucide-react';
import { createPortal } from 'react-dom';
import { Tabs, TabsList, TabsTrigger } from '@site/components/ui/tabs';
import { Slider } from '@site/components/ui/slider';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@site/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@site/components/ui/select';
import { Switch } from '@site/components/ui/switch';
import { useLang } from '@site/lib/i18n';
import { useSiteEnv } from '@site/lib/site-env';
import { preparePhoto } from '@site/lib/photo';
import { castShadow, softEdged } from '@site/lib/shadow';
import { NEUTRAL, litProduct, measureLight, tintOf, type Tint } from '@site/lib/light';
import { cropRound, widthBeside, type Choice } from '@site/lib/shelf';
import { QR_MARK, markedQrPng } from '@/lib/qr-mark';
import { earringPlacement, glassesPlacement, handPoints, necklacePlacement, watchPlacement } from '@site/lib/placement';
import { kindOf, pairProductOf } from '@site/lib/pair-product';
import CameraTryOn from '@site/components/tryon/CameraTryOn';
import { dataUrlBlob, inviteText, linkOrHere, savePicture, sharePicture } from '@site/lib/share-picture';
import { inZone } from '@/lib/tryon-placement';
import { Guide } from './guides';
import { detectHand } from '@site/lib/hand-detect';
import { detectFace } from '@site/lib/face-detect';
import { poseFromHeader, poseOnStage, type SharedPose } from '@site/lib/pair-pose';
import { nextPhoto } from '@site/lib/pair-photos';
import {
  DEMO_WATCH, PX_PER_MM, REFERENCES, STAGE, constrainToModel, modelsFor,
  type ModelId, type Pose, type ReferenceId, type TryOnProduct,
} from '@site/lib/demo-product';

type Mode = 'model' | 'me' | 'compare';
const { W, H } = STAGE;
const REF_IDS = Object.keys(REFERENCES) as ReferenceId[];

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
const loadPlain = (src: string, cors: boolean) =>
  new Promise<HTMLImageElement>((resolve, reject) => {
    const i = new Image();
    if (cors) i.crossOrigin = 'anonymous';
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('Image could not be loaded'));
    i.src = src;
  });
// T137: asked for with CORS (the CDN allows it), so the picture can be saved. A copy the browser kept from a plain request
// (the CDN's plain answer does not vary by origin) can fail that: then once more at a fresh address; a server that never
// allows it — as before, a picture that cannot be saved.
const fresh = (src: string) => src + (src.includes('?') ? '&' : '?') + 'cors=1';
/** T139: how many of the shopper's photos are kept to switch between (the oldest goes first). */
const MAX_PHOTOS = 8;
const loadImage = (src: string) => (/^(data|blob):/.test(src)
  ? loadPlain(src, false)
  : loadPlain(src, true).catch(() => loadPlain(fresh(src), true)).catch(() => loadPlain(src, false)));

/**
 * `product`: the watch to try on — the Failet demo unless a merchant's own is given (P5, T26). T137: `stageExtras` —
 * what the page around puts on the picture itself (the shop window's mark, on a phone); `helpExtra` — what it adds to
 * the help screen (the privacy line); `topbarExtra` — what it adds beside the tabs (the shop window's close, on a phone,
 * where the help button was — Nader: the help goes onto the picture, the close beside the tabs).
 */
export default function Studio({ product = DEMO_WATCH, stageExtras = null, helpExtra = null, topbarExtra = null, shareLink, qrMark = QR_MARK, compareWith = [] }: { product?: TryOnProduct; stageExtras?: React.ReactNode; helpExtra?: React.ReactNode; topbarExtra?: React.ReactNode; qrMark?: string | null; /** T140.1: the store's other products of this kind, to put beside this one on the shopper's photo */ compareWith?: Choice[]; shareLink?: string | null } = {}) {
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
  // T134.6: where the store set it on this photo, if it did — its size a share of the true size
  const spotOf = (i: number) => product.placement?.[MODELS[i]?.id as ModelId] ?? null;
  const modelPose = (i: number): Pose => {
    const k = product.caseMm / baseMm;
    const base = k === 1 ? { ...MODELS[i].pose } : { ...MODELS[i].pose, width: MODELS[i].pose.width * k };
    const spot = spotOf(i);
    return spot ? { x: spot.pose.x, y: spot.pose.y, angle: spot.pose.angle, width: base.width * spot.pose.scale } : base;
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
  const [cameraOpen, setCameraOpen] = useState(false); // T137: on a phone, the camera with the guide (CameraTryOn)
  const [helpOpen, setHelpOpen] = useState(false);
  const [pair, setPair] = useState<{ id: string; expiresAt: number } | null>(null);
  const [qrImage, setQrImage] = useState('');
  const [pairBusy, setPairBusy] = useState(false);
  const [pairError, setPairError] = useState('');
  // T139 (Nader): the shopper's photos this visit — sent from the phone (several, in one pairing), taken or uploaded —
  // to switch between; each keeps its own fit. The refs let the pairing's timer read what is shown now.
  const [myPhotos, setMyPhotos] = useState<{ id: number; src: string; pose: Pose | null; fit: Pose | null; scale: number }[]>([]);
  const [currentPhoto, setCurrentPhoto] = useState<number | null>(null);
  const photoSeq = useRef(0);
  const pairGot = useRef(0); // photos received through the pairing now open
  // T140.1 (Nader): "this watch or that one" — the shopper's photo twice, side by side, each with one product at its
  // real size, where the shopper fitted this one, lit like the photo
  const [compareOpen, setCompareOpen] = useState(false);
  const [compareTo, setCompareTo] = useState(0);
  const compareHalves = useRef<(HTMLCanvasElement | null)[]>([null, null]);
  const compareImages = useRef(new Map<string, Promise<HTMLImageElement>>());
  // a product whose picture does not load is dropped from the choices (never a half left showing the one before)
  const [compareBroken, setCompareBroken] = useState<string[]>([]);
  const choices = compareWith.filter((c) => !compareBroken.includes(c.ref));
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
  // T140.2: how the product is lit on the shopper's photo shown now (measured once per photo)
  const photoTint = useRef<Tint>(NEUTRAL);
  const shownNow = useRef<{ pose: Pose; fit: Pose; scale: number; current: number | null; photos: typeof myPhotos; qrOpen: boolean; pair: typeof pair }>(null!);
  shownNow.current = { pose, fit: photoFit, scale, current: currentPhoto, photos: myPhotos, qrOpen, pair };
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
      // T134.1: a contact and an ambient shadow in the product's own shape, so it sits on the skin (was one flat shadow)
      castShadow(ctx, im, { x: pose.x, y: pose.y, width, height, angle: pose.angle }, mode === 'compare' ? 'flat' : product.category ?? 'watch');
      ctx.save();
      ctx.translate(pose.x, pose.y); ctx.rotate((pose.angle * Math.PI) / 180);
      // T134.1: on a photo its outline softened by about a pixel, so it reads as photographed there, not pasted on
      const seen = Math.hypot(ctx.getTransform().a, ctx.getTransform().b) || 1;
      // T140.2: on the shopper's own photo, lit like it — darker in dim light, a little towards a lamp's colour
      const lit = mode === 'me' ? litProduct(im, photoTint.current) : im;
      ctx.drawImage(mode === 'compare' ? im : softEdged(lit, width * seen), -width / 2, -height / 2, width, height);
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
  }, [assetsReady, mode, model, photo, pose, scale, zoom, ref, refPose, active, rulers, units, ar, calibrating, points, product.caseMm, product.category]);
  useEffect(() => redraw(), [redraw]);

  function getPoint(e: { clientX: number; clientY: number }) {
    const r = canvas.current!.getBoundingClientRect();
    // T136: the canvas is fitted as its CSS says (cover fills the box, contain shows it whole) — so a phone's tall photo,
    // drawn to fill the screen, still takes a finger where it lands
    const cover = getComputedStyle(canvas.current!).objectFit === 'cover';
    const fit = cover ? Math.max(r.width / W, r.height / H) : Math.min(r.width / W, r.height / H);
    const ox = (r.width - W * fit) / 2, oy = (r.height - H * fit) / 2;
    return { x: ((e.clientX - r.left - ox) / fit - W / 2) / zoom + W / 2, y: ((e.clientY - r.top - oy) / fit - H / 2) / zoom + H / 2 };
  }
  function constrain(p: Pose): Pose {
    if (mode !== 'model') return { ...p, x: clamp(p.x, 50, W - 50), y: clamp(p.y, 50, H - 50) };
    const spot = spotOf(model); // T134.6: the store's zone, when it set one; the built-in box otherwise
    if (spot) return { ...p, ...inZone(p, spot.zone) };
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
      if (isBag) { // T84: the wrist and the middle finger's knuckle, a palm's length (about 100 mm) apart, give the scale
        if (distance < 12) { notify(t('Tap the knuckle of your middle finger.', 'حدّد مفصل إصبعك الوسطى.')); return; }
        const fit = bagPose(a, p, 0, null);
        setPose(fit); setPhotoFit(fit); setScale(100); setCalibrating(false); setPoints([]);
        notify(t('Fit adjusted. You can still drag it.', 'تم ضبط الحقيبة. يمكنك تحريكها.'));
        return;
      }
      if (isEarring) { // T83: the top of the ear, then the bottom of the lobe — the ear, about 60 mm long, gives the scale
        if (distance < 20) { notify(t('Tap the bottom of your earlobe.', 'حدّد أسفل شحمة أذنك.')); return; }
        const fit = earringPose(a, p);
        setPose(fit); setPhotoFit(fit); setScale(100); setCalibrating(false); setPoints([]);
        notify(t('Fit adjusted. You can still drag it.', 'تم ضبط القرط. يمكنك تحريكه.'));
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
  function glassesPose(a: { x: number; y: number }, b: { x: number; y: number }, ordered = false): Pose {
    const p = glassesPlacement(a, b, product.caseMm, ordered); // T134.3: the rule now lives in site/lib/placement.ts (the phone page uses it too)
    return { x: clamp(p.x, 50, W - 50), y: clamp(p.y, 50, H - 50), width: clamp(p.width, 80, 1100), angle: p.angle };
  }

  /**
   * T68 — a necklace from the chin and the pupils (stage coordinates): drawn at its width on the pupils'
   * scale (62 mm apart), hanging straight, its chains starting about 9.6 mm below the chin — as on the
   * model photo it was measured on.
   */
  function necklacePose(chin: { x: number; y: number }, ipd: number): Pose {
    const w = images.current.watch;
    const raw = necklacePlacement(chin, ipd, product.caseMm, w ? w.height / w.width : 1); // T134.3: site/lib/placement.ts
    const width = clamp(raw.width, 60, 1100);
    const height = w ? (width * w.height) / w.width : width;
    return { x: clamp(chin.x, 50, W - 50), y: clamp(raw.y - raw.width * (w ? w.height / w.width : 1) / 2 + height / 2, 50, H - 50), width, angle: 0 };
  }

  /**
   * T83 — an earring on the shopper's own ear, from two taps: the top of the ear and the bottom of the
   * lobe. The ear is taken as 60 mm long (as on the ear model photo); the piercing sits about 9 mm above
   * the lobe's bottom (measured on that photo: 15% of the ear), and the earring's picture hangs straight
   * down from there, its top edge at the piercing — the demo hoop's hinge is within 6% of its top.
   */
  function earringPose(top: { x: number; y: number }, lobe: { x: number; y: number }): Pose {
    const w = images.current.watch;
    const aspect = w ? w.height / w.width : 1;
    const raw = earringPlacement(top, lobe, product.caseMm, aspect); // T134.3: site/lib/placement.ts
    const width = clamp(raw.width, 12, 600);
    const pierceY = raw.y - (raw.width * aspect) / 2;
    return { x: clamp(raw.x, 20, W - 20), y: clamp(pierceY + (width * aspect) / 2, 20, H - 20), width, angle: 0 };
  }

  /**
   * T84 — a bag in the shopper's own hand. A hand that carries a bag hangs at the side, often seen edge-on,
   * which squeezes the knuckles together; so the scale is the larger of two adult measures: the palm, wrist
   * to the middle finger's knuckle, about 100 mm, and the index and little fingers' knuckles, about 62 mm
   * apart (as for a ring) — seen at an angle, a length only looks shorter. The bag hangs straight down, the
   * top of its handles where the fingers curl round them: the grip (the middle finger between its base and
   * middle joints, when the hand is found), or a quarter of a palm past the knuckle from two taps — on the
   * demo model her fingers start just above the handles' top. Handles are taken as centred.
   */
  function bagPose(wrist: { x: number; y: number }, knuckle: { x: number; y: number }, knuckleSpan: number, grip: { x: number; y: number } | null): Pose {
    const palm = Math.hypot(knuckle.x - wrist.x, knuckle.y - wrist.y);
    const pxPerMm = Math.max(palm / 100, knuckleSpan / 62);
    const top = grip ?? { x: knuckle.x + (knuckle.x - wrist.x) * 0.25, y: knuckle.y + (knuckle.y - wrist.y) * 0.25 };
    const width = clamp(product.caseMm * pxPerMm, 30, 2400);
    const w = images.current.watch;
    const height = w ? (width * w.height) / w.width : width;
    return { x: top.x, y: top.y + height / 2, width, angle: 0 };
  }

  /** T84 — find the hand in the shopper's photo (on this device, the same model as the wrist) and hang the bag from it. */
  async function fitBagToHand(img: HTMLImageElement, request: number) {
    try {
      if (!handDetector.current) {
        const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
        const vision = await FilesetResolver.forVisionTasks(asset('/wasm'));
        handDetector.current = await HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: asset('/assets/hand-landmarker.task'), delegate: 'CPU' },
          runningMode: 'IMAGE', numHands: 1, minHandDetectionConfidence: 0.35,
        });
      }
      const result = (await detectHand(handDetector.current, img)) ?? { landmarks: [] }; // T134.5: turned, then a weaker sighting
      if (request !== photoRequest.current) return;
      const lm = result.landmarks?.[0];
      if (lm) {
        const f = Math.min(W / img.width, H / img.height);
        const ox = (W - img.width * f) / 2, oy = (H - img.height * f) / 2;
        const at = (i: number) => ({ x: lm[i].x * img.width * f + ox, y: lm[i].y * img.height * f + oy });
        const base = at(9), middle = at(10);
        const index = at(5), little = at(17);
        const fit = bagPose(at(0), base, Math.hypot(index.x - little.x, index.y - little.y), { x: (base.x + middle.x) / 2, y: (base.y + middle.y) / 2 });
        setPose(fit); setPhotoFit(fit);
        notify(t('Hand found. Fine-tune the fit if needed.', 'تم تحديد اليد. عدّل موضع الحقيبة عند الحاجة.'));
      } else notify(t('Hand not found. Use “Fit to hand” to place the bag.', 'لم يتم تحديد اليد. استخدم «ضبط على اليد».'));
    } catch {
      notify(t('Use “Fit to hand” to place the bag on the photo.', 'استخدم «ضبط على اليد» لتحديد موضع الحقيبة.'));
    }
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
      const result = (await detectFace(faceDetector.current, img)) ?? { faceLandmarks: [] }; // T134.5: a sideways photo too
      if (request !== photoRequest.current) return;
      const lm = result.faceLandmarks?.[0];
      if (lm && lm[468] && lm[473]) { // the two iris centres
        const f = Math.min(W / img.width, H / img.height);
        const ox = (W - img.width * f) / 2, oy = (H - img.height * f) / 2;
        const at = (i: number) => ({ x: lm[i].x * img.width * f + ox, y: lm[i].y * img.height * f + oy });
        const fit = isNecklace && lm[152]
          ? necklacePose(at(152), Math.hypot(at(473).x - at(468).x, at(473).y - at(468).y))
          : glassesPose(at(468), at(473), true); // T134.7: the detector's order — a turned face's glasses turn with it
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
      const result = (await detectHand(handDetector.current, img)) ?? { landmarks: [] }; // T134.5: turned, then a weaker sighting
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

  async function applyPhoto(blob: Blob, shared: SharedPose | null = null, said: string | null = null) {
    const request = ++photoRequest.current;
    setPhotoBusy(true);
    try {
      const prepared = await preparePhoto(blob);
      const img = await loadImage(prepared.dataUrl);
      if (request !== photoRequest.current) return;
      keepFit();
      const id = ++photoSeq.current;
      setMyPhotos((list) => [...list, { id, src: prepared.dataUrl, pose: null, fit: null, scale: 100 }].slice(-MAX_PHOTOS));
      setCurrentPhoto(id);
      images.current.photo = img;
      photoTint.current = tintOf(measureLight(img));
      setPhoto(prepared.dataUrl); setMode('me'); setZoom(1); setScale(100); setCalibrating(false);
      let base = { x: 600, y: 570, width: 155, angle: 0 };
      setPose(base); setPhotoFit(base);
      if (shared) { // T134.7: the shopper fitted it on their phone — show that, not a new guess
        const p = poseOnStage(shared, img, { W, H });
        const fit = { x: clamp(p.x, 0, W), y: clamp(p.y, 0, H), width: clamp(p.width, 8, 2400), angle: p.angle };
        setPose(fit); setPhotoFit(fit);
        notify(said ?? t('As you left it on your phone. Adjust it here if needed.', 'كما تركته على جوالك. عدّله هنا عند الحاجة.'));
        return;
      }
      if (isEarring) { setCalibrating(true); setPoints([]); notify(t('Tap the top of your ear, then the bottom of your earlobe.', 'حدّد أعلى أذنك، ثم أسفل شحمة الأذن.')); return; } // T83
      if (isGlasses || isNecklace) { await fitGlassesToFace(img, request); return; } // T68; a watch, as before:
      if (isRing) { await fitRingToHand(img, request); return; }
      if (isBag) { await fitBagToHand(img, request); return; } // T84
      try {
        if (!handDetector.current) {
          const { FilesetResolver, HandLandmarker } = await import('@mediapipe/tasks-vision');
          const vision = await FilesetResolver.forVisionTasks(asset('/wasm'));
          handDetector.current = await HandLandmarker.createFromOptions(vision, {
            baseOptions: { modelAssetPath: asset('/assets/hand-landmarker.task'), delegate: 'CPU' },
            runningMode: 'IMAGE', numHands: 1, minHandDetectionConfidence: 0.35,
          });
        }
        // T134.5 / T138: harder looks (turned, shrunk, zoomed, then a weaker sighting), and the watch at its real case
        // width with the hand as the ruler (site/lib/placement.ts) — it took 90 % of the palm's width before
        const found = await detectHand(handDetector.current, img);
        if (request !== photoRequest.current) return;
        const f = Math.min(W / img.width, H / img.height);
        const hand = found ? handPoints(found.landmarks[0]!, img, { scale: f, ox: (W - img.width * f) / 2, oy: (H - img.height * f) / 2 }) : null;
        if (found && hand) {
          const fit = watchPlacement(hand, product.caseMm, found.score);
          base = { x: clamp(fit.x, 50, W - 50), y: clamp(fit.y, 50, H - 50), width: clamp(fit.width, 30, 400), angle: fit.angle };
          setPose(base); setPhotoFit(base);
          notify(fit.confidence < 0.45
            ? t('Wrist found — check the fit and adjust it if needed.', 'تم تحديد المعصم — تأكد من الموضع وعدّله عند الحاجة.')
            : t('Wrist found. Fine-tune the fit if needed.', 'تم تحديد المعصم. عدّل موضع الساعة عند الحاجة.'));
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
      // T134.3: the kind (the phone's guide) and, on the demo, which demo product — the server reads the rest itself
      const r = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind: kindOf(product), ...(product.demo ? { demo: product.sku } : {}) }) });
      if (!r.ok) throw Error();
      const p = (await r.json()) as { id: string; expiresAt: number };
      pairGot.current = 0;
      setPair(p);
      // T134.2: Tajribah's mark in the code's corner, error correction H (it still reads — lib/qr-mark.ts)
      // T134.2: the corner mark — Tajribah's, or a white-label store's own logo (`qrMark`; null: a plain corner)
      setQrImage(await markedQrPng(`${window.location.origin}/capture/${p.id}`, 480, qrMark, { dark: '#0A2237', light: '#ffffff' }));
    } catch {
      setPairError(t('Could not connect. Try again or upload a photo here.', 'تعذر الاتصال. حاول مجدداً أو ارفع الصورة هنا.'));
    } finally { setPairBusy(false); }
  }
  useEffect(() => { if (qrOpen && !pair && !pairBusy && !pairError) void startPair(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [qrOpen, pair, pairBusy, pairError]);
  // T139: the phone may send several photos — the pairing keeps listening after the first (until it expires or this
  // page closes), each photo taken from the session and deleted there the moment it is here, then shown as one more of
  // the shopper's photos. (Before, the session was ended on the first photo: the phone's next send said «انتهت».)
  useEffect(() => {
    if (!pair) return;
    let disposed = false, pending = false;
    const ended = () => {
      if (shownNow.current.qrOpen) setPairError(t('This QR code has expired. Create a new one.', 'انتهت صلاحية الرمز. أنشئ رمزاً جديداً.'));
      else { setPair(null); setQrImage(''); }
    };
    const timer = setInterval(async () => {
      if (disposed || pending) return;
      pending = true;
      try {
        if (Date.now() > pair.expiresAt) { clearInterval(timer); ended(); return; }
        const next = await nextPhoto(pair.id);
        if (next === 'expired') { clearInterval(timer); ended(); return; }
        if (!next || disposed) return;
        const more = pairGot.current++ > 0;
        setQrOpen(false);
        // T134.7: as the shopper left it on the phone
        await applyPhoto(next.blob, poseFromHeader(next.pose), more ? t('Another photo from your phone — switch between your photos below.', 'وصلت صورة أخرى من جوالك — بدّل بين صورك من الأسفل.') : null);
      } catch {
        if (!disposed && shownNow.current.qrOpen) setPairError(t('Connection interrupted. Try a new QR code.', 'انقطع الاتصال. جرّب رمزاً جديداً.'));
      } finally { pending = false; }
    }, 2500);
    return () => { disposed = true; clearInterval(timer); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pair, ar]);
  // leaving the page ends the pairing (anything not yet received goes with it)
  useEffect(() => () => { const open = shownNow.current.pair; if (open) void fetch(`/api/pair/${open.id}`, { method: 'DELETE', keepalive: true }); }, []);
  function closePair(open: boolean) {
    setQrOpen(open);
    // T139: once a photo has come, closing keeps the pairing listening for more from the phone; before, it ends it
    if (!open && pair && pairGot.current === 0) { void fetch(`/api/pair/${pair.id}`, { method: 'DELETE' }); setPair(null); setQrImage(''); setPairError(''); }
  }
  /** The photo shown keeps where its product is, for when the shopper comes back to it (T139). */
  function keepFit() {
    const now = shownNow.current;
    if (now.current !== null) setMyPhotos((list) => list.map((p) => (p.id === now.current ? { ...p, pose: now.pose, fit: now.fit, scale: now.scale } : p)));
  }
  async function showPhoto(id: number) {
    const target = shownNow.current.photos.find((p) => p.id === id);
    if (!target || id === shownNow.current.current) return;
    ++photoRequest.current; // a fit still being found for the photo left behind does not land on this one
    keepFit();
    const img = await loadImage(target.src);
    images.current.photo = img;
    photoTint.current = tintOf(measureLight(img));
    const fit = target.fit ?? { x: 600, y: 570, width: 155, angle: 0 };
    setPhoto(target.src); setMode('me'); setZoom(1); setCalibrating(false); setPoints([]); setPhotoBusy(false);
    setPose(target.pose ?? fit); setPhotoFit(fit); setScale(target.scale); setCurrentPhoto(id);
  }
  // T140.1: draw both halves — the photo as the stage shows it, each product where the shopper fitted this one (the
  // other at its own real size against it), lit like the photo, cropped round them the same way
  useEffect(() => {
    if (!compareOpen || !photo || !images.current.photo) return;
    const other = choices[compareTo];
    if (!other) return;
    let live = true;
    const load = (src: string) => {
      let p = compareImages.current.get(src);
      if (!p) { p = loadImage(src); compareImages.current.set(src, p); }
      return p;
    };
    void Promise.all([images.current.watch ? Promise.resolve(images.current.watch) : load(asset(product.worn)), load(asset(other.product.worn))]).then(([mine, theirs]) => {
      const ph = images.current.photo;
      if (!live || !ph) return;
      const first = (pose.width * scale) / 100;
      const widths = [first, widthBeside(first, product.caseMm, other.product.caseMm)];
      const crop = cropRound(pose, Math.max(...widths), { W, H });
      [mine, theirs].forEach((im, i) => {
        const out = compareHalves.current[i];
        if (!out) return;
        const full = document.createElement('canvas');
        full.width = W; full.height = H;
        const g = full.getContext('2d')!;
        g.fillStyle = '#fff'; g.fillRect(0, 0, W, H);
        const f = Math.min(W / ph.width, H / ph.height);
        g.drawImage(ph, (W - ph.width * f) / 2, (H - ph.height * f) / 2, ph.width * f, ph.height * f);
        const width = widths[i]!, height = (width * im.height) / im.width;
        castShadow(g, im, { x: pose.x, y: pose.y, width, height, angle: pose.angle }, product.category ?? 'watch');
        g.save(); g.translate(pose.x, pose.y); g.rotate((pose.angle * Math.PI) / 180);
        g.drawImage(softEdged(litProduct(im, photoTint.current), width), -width / 2, -height / 2, width, height);
        g.restore();
        out.width = Math.round(crop.side); out.height = Math.round(crop.side);
        out.getContext('2d')!.drawImage(full, crop.x, crop.y, crop.side, crop.side, 0, 0, out.width, out.height);
      });
    }).catch(() => { if (live) { setCompareBroken((b) => [...b, other.ref]); setCompareTo(0); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compareOpen, compareTo, photo, pose, scale, compareWith, compareBroken]);
  function forgetPhoto(id: number) {
    const rest = shownNow.current.photos.filter((p) => p.id !== id);
    if (id === shownNow.current.current) {
      const other = rest.at(-1);
      if (other) void showPhoto(other.id);
      else { ++photoRequest.current; setPhoto(null); setCurrentPhoto(null); }
    }
    setMyPhotos(rest);
  }
  /**
   * T137: the picture as it is shown — through the phone's share sheet, or saved as a file. Made at once and shared
   * inside the tap: a phone refuses a share started after waiting.
   */
  function shareImage(share = isPhone) {
    if (!canvas.current) return;
    try {
      const file = new File([dataUrlBlob(canvas.current.toDataURL('image/png'))], 'tajribah-try-on.png', { type: 'image/png' });
      // T137: an invitation — the product's name and where others can try it (this page, when no link is given)
      const name = t(product.name.en, product.name.ar), link = linkOrHere(shareLink);
      void (share ? sharePicture(file, { title: name, text: inviteText(name, link, ar), url: link }) : Promise.resolve(savePicture(file))).then((how) => { if (how === 'saved') notify(t('Your image is ready.', 'صورتك جاهزة.')); });
    } catch { notify(t('Could not save the image. Please try again.', 'تعذر حفظ الصورة. حاول مجدداً.')); }
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
              {topbarExtra}
            </div>
          </div>

          {/* T136: on a phone, the shopper's photo is the picture — the stage takes its shape (a tall photo, a tall stage) */}
          <div className={'stage ' + (mode !== 'model' ? 'compare-stage' : '') + (mode === 'me' && photo ? ' me-photo' : '')}
            style={mode === 'me' && photo && images.current.photo ? ({ '--photo-ar': String(images.current.photo.width / images.current.photo.height) } as React.CSSProperties) : undefined}>
            {/* T137: on the picture, as Tangiblee's — the measurements (a ruler; the unit beside it) and back to the whole view */}
            {/* the help, on a phone in the shop's window: on the picture's corner, where the close was (the close went beside the tabs) */}
            <button type="button" className="stage-chip stage-help" aria-label={t('How it works', 'طريقة الاستخدام')} title={t('How it works', 'طريقة الاستخدام')} onClick={() => setHelpOpen(true)}><HelpCircle size={17} /></button>
            {showCanvas && (
              <div className="stage-tools">
                <div className="stage-tools-row">
                  <button type="button" className={'stage-chip' + (rulers ? ' is-on' : '')} aria-pressed={rulers} title={t('Measurements', 'المقاسات')} aria-label={t('Show measurements', 'إظهار المقاسات')} onClick={() => setRulers((r) => !r)}><Ruler size={18} /></button>
                  {rulers && <button type="button" className="stage-chip stage-unit" title={t('Measurement units', 'وحدة القياس')} aria-label={t('Measurement units', 'وحدة القياس')} onClick={() => setUnits((u) => (u === 'mm' ? 'in' : 'mm'))}>{units === 'mm' ? t('mm', 'مم') : t('in', 'بوصة')}</button>}
                </div>
                {zoom !== 1 && <button type="button" className="stage-chip stage-reset" title={t('Reset view', 'إعادة ضبط العرض')} aria-label={t('Reset view', 'إعادة ضبط العرض')} onClick={() => reset()}><RotateCcw size={17} /></button>}
              </div>
            )}
            {stageExtras}
            {showCanvas ? (
              <>
                <div className="stage-label"><span className="label-line" />
                  {mode === 'model' ? t(MODELS[model].stageLabel.en, MODELS[model].stageLabel.ar)
                    : mode === 'compare' ? t('Size in perspective', 'الحجم عن قرب')
                      : t('Your personal try-on', 'تجربتك الخاصة')}
                </div>
                <canvas ref={canvas} width={W} height={H} tabIndex={0} data-pose={`${Math.round(pose.x)},${Math.round(pose.y)},${Math.round(pose.width)},${Math.round(pose.angle)}`}
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
                {photoBusy && <div className="detecting"><LoaderCircle size={16} className="spin" />{isNecklace ? t('Finding your face…', 'جارٍ تحديد الوجه…') : isRing || isBag ? t('Finding your hand…', 'جارٍ تحديد اليد…') : isGlasses ? t('Finding your face…', 'جارٍ تحديد الوجه…') : t('Finding your wrist…', 'جارٍ تحديد المعصم…')}</div>}
                {calibrating && (
                  <div className="calibration-prompt">
                    <span>{isBag ? (points.length ? t('2. Tap the knuckle of your middle finger', '2. حدّد مفصل الإصبع الوسطى') : t('1. Tap your wrist, where your hand begins', '1. حدّد معصمك حيث تبدأ اليد')) : isEarring ? (points.length ? t('2. Tap the bottom of your earlobe', '2. حدّد أسفل شحمة أذنك') : t('1. Tap the top of your ear', '1. حدّد أعلى أذنك')) : isNecklace ? (points.length ? t('2. Tap the centre of your other eye', '٢. حدّد منتصف عينك الأخرى') : t('1. Tap the centre of one eye', '١. حدّد منتصف إحدى عينيك')) : isRing ? (points.length ? t('2. Tap the other side of your ring finger', '٢. حدّد الجهة الأخرى من البنصر') : t('1. Tap one side of your ring finger, where the ring sits', '١. حدّد جهة من البنصر حيث يُلبس الخاتم')) : isGlasses ? (points.length ? t('2. Tap the centre of your other eye', '٢. حدّد منتصف عينك الأخرى') : t('1. Tap the centre of one eye', '١. حدّد منتصف إحدى عينيك')) : points.length ? t('2. Tap the opposite edge of your wrist', '٢. حدد الحافة المقابلة من المعصم') : t('1. Tap one edge of your wrist', '١. حدد إحدى حافتي المعصم')}</span>
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
                <div className="personal-guide"><Guide kind={kindOf(product)} outline={1} fill="slice" product={{ src: asset(product.worn), caseMm: product.caseMm, aspect: images.current.watch ? images.current.watch.height / images.current.watch.width : 1 }} /></div>
                <span className="eyebrow">{t('Make it personal', 'جرّبها بنفسك')}</span>
                <h2>{isBag ? t('Your hand. Your bag.', 'يدك. حقيبتك.') : isEarring ? t('Your ear. Your earring.', 'أذنك. قرطك.') : isNecklace ? t('You. Your necklace.', 'أنتِ. قلادتك.') : isRing ? t('Your hand. Your ring.', 'يدك. خاتمك.') : isGlasses ? t('Your face. Your frame.', 'وجهك. إطارك.') : t('Your wrist. Your watch.', 'معصمك. ساعتك.')}</h2>
                <p>{isBag ? t('See it in your hand with a photo of you, your hand down at your side. It stays on this device.', 'شاهدي الحقيبة في يدك بصورة لك ويدك منسدلة إلى جانبك. تبقى الصورة على جهازك.') : isEarring ? t('See how it looks on you with a side photo, your ear in view. You tap the top of your ear and your earlobe; it stays on this device.', 'شاهدي كيف يبدو القرط عليك بصورة جانبية تظهر فيها الأذن. تحدّدين أعلى الأذن وشحمتها، وتبقى الصورة على جهازك.') : isNecklace ? t('See how it looks on you with a front photo, your face and chest in view. It stays on this device.', 'شاهدي كيف تبدو القلادة عليك بصورة أمامية يظهر فيها الوجه والصدر. تبقى الصورة على جهازك.') : isRing ? t('See how it looks on you with a photo of the back of your hand, fingers apart. It stays on this device.', 'شاهد كيف يبدو الخاتم عليك بصورة لظهر يدك والأصابع متباعدة. تبقى الصورة على جهازك.') : isGlasses ? t('See how it looks on you with a front photo of your face. It stays on this device.', 'شاهد كيف تبدو النظارة عليك بصورة أمامية لوجهك. تبقى الصورة على جهازك.') : t('See how it looks on you with a photo of your wrist.', 'شاهد كيف تبدو الساعة عليك باستخدام صورة لمعصمك.')}</p>
                <button className="primary-button" onClick={() => (isPhone ? setCameraOpen(true) : features.pairing ? setQrOpen(true) : file.current?.click())}>
                  {isPhone ? <Camera size={18} /> : features.pairing ? <Smartphone size={18} /> : <Upload size={18} />}
                  {isPhone ? (isBag ? t('Take a photo of you', 'التقطي صورة لك') : isEarring ? t('Take a side photo', 'التقطي صورة جانبية') : isNecklace ? t('Take a front photo', 'التقطي صورة أمامية') : isRing ? t('Take a photo of your hand', 'التقط صورة ليدك') : isGlasses ? t('Take a selfie', 'التقط صورة لوجهك') : t('Take a wrist photo', 'التقط صورة لمعصمك'))
                    : features.pairing ? t('Continue on your phone', 'أكمل التجربة من جوالك')
                      : isBag ? t('Upload a photo of you', 'ارفعي صورة لك') : isEarring ? t('Upload a side photo', 'ارفعي صورة جانبية') : isNecklace ? t('Upload a front photo', 'ارفعي صورة أمامية') : isRing ? t('Upload a hand photo', 'ارفع صورة ليدك') : isGlasses ? t('Upload a face photo', 'ارفع صورة لوجهك') : t('Upload a wrist photo', 'ارفع صورة لمعصمك')}
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
                <>
                {photo && myPhotos.length > 1 && (
                  <div className="my-photos" role="group" aria-label={t('Your photos', 'صورك')}>
                    {myPhotos.map((p, n) => (
                      <span key={p.id} className={'my-photo' + (p.id === currentPhoto ? ' selected' : '')}>
                        <button type="button" onClick={() => void showPhoto(p.id)} aria-pressed={p.id === currentPhoto} aria-label={t(`Photo ${n + 1}`, `الصورة ${n + 1}`)}><img src={p.src} alt="" /></button>
                        <button type="button" className="my-photo-remove" onClick={() => forgetPhoto(p.id)} aria-label={t(`Remove photo ${n + 1}`, `احذف الصورة ${n + 1}`)}><X size={12} aria-hidden /></button>
                      </span>
                    ))}
                  </div>
                )}
                <div className="photo-actions">
                  <button className="secondary-button" onClick={() => (isPhone ? setCameraOpen(true) : file.current?.click())}><ImagePlus size={16} />{photo ? t('Change photo', 'تغيير الصورة') : t('Upload a photo', 'ارفع صورة')}</button>
                  {photo && <button className="secondary-button" onClick={() => { setCalibrating(true); setPoints([]); setZoom(1); }}><Maximize2 size={16} />{isBag ? t('Fit to hand', 'ضبط على اليد') : isEarring ? t('Fit to ear', 'ضبط على الأذن') : isNecklace ? t('Fit to eyes', 'ضبط على العينين') : isRing ? t('Fit to finger', 'ضبط على الإصبع') : isGlasses ? t('Fit to eyes', 'ضبط على العينين') : t('Fit to wrist', 'ضبط على المعصم')}</button>}
                  {/* T137: after a photo — save it as a file, or share it (the phone's own sheet) */}
                  {photo && features.download && <button className="secondary-button save-photo" disabled={!assetsReady || photoBusy} onClick={() => shareImage(false)}><Download size={16} />{t('Save the picture', 'احفظ الصورة')}</button>}
                  {photo && features.download && isPhone && <button className="secondary-button save-photo" disabled={!assetsReady || photoBusy} onClick={() => shareImage(true)}><Share2 size={16} />{t('Share the picture', 'شارك الصورة')}</button>}
                  {photo && choices.length > 0 && <button className="secondary-button compare-button" onClick={() => setCompareOpen(true)}><Columns2 size={16} />{t('Compare', 'قارن')}</button>}
                  {features.pairing && !isPhone && <button className="icon-button" aria-label={t('Use your phone', 'استخدام الجوال')} onClick={() => setQrOpen(true)}><QrCode size={19} /></button>}
                </div>
                </>
              )}
            </div>
            {showCanvas && (
              <div className="adjustments">
                <div className="adjustment">
                  <div className="adjustment-label"><span className="adjustment-name">
                    {/* T137 (Nader): the rotate icon also puts the turn back — the view's own angle (0° in the comparison) */}
                    <button type="button" className="adjust-reset" aria-label={t('Reset rotation', 'أعد الدوران')} title={t('Reset rotation', 'أعد الدوران')}
                      onClick={() => (mode === 'compare' && active === 'object' ? setRefPose((p) => ({ ...p, angle: 0 }))
                        : setPose((p) => ({ ...p, angle: mode === 'model' ? modelPose(model).angle : mode === 'me' ? photoFit.angle : 0 })))}>
                      <RotateCw size={14} aria-hidden />
                    </button>
                    <label id="rotation-label">{mode === 'compare' && active === 'object' ? t('Object rotation', 'تدوير العنصر') : t('Rotation', 'التدوير')}</label></span>
                    <span dir="ltr">{Math.round(active === 'object' && mode === 'compare' ? refPose.angle : pose.angle)}°</span></div>
                  <Slider aria-labelledby="rotation-label" value={[active === 'object' && mode === 'compare' ? refPose.angle : pose.angle]} min={-180} max={180} step={1}
                    onValueChange={([angle]) => (active === 'object' && mode === 'compare' ? setRefPose((p) => ({ ...p, angle })) : setPose((p) => ({ ...p, angle })))} />
                </div>
                {mode !== 'compare' && (
                  <div className="adjustment">
                    <div className="adjustment-label"><label id="scale-label"><Scaling size={14} aria-hidden />{isEarring ? t('Earring size', 'حجم القرط') : isBag ? t('Bag size', 'حجم الحقيبة') : isNecklace ? t('Necklace size', 'حجم القلادة') : isRing ? t('Ring size', 'حجم الخاتم') : isGlasses ? t('Glasses size', 'حجم النظارة') : t('Watch size', 'حجم الساعة')}</label><span dir="ltr">{scale}%</span></div>
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
        className="sr-only" aria-label={isBag ? t('Choose a photo of you', 'اختاري صورة لك') : isEarring ? t('Choose a side photo', 'اختاري صورة جانبية') : isNecklace ? t('Choose a front photo', 'اختاري صورة أمامية') : isRing ? t('Choose hand photo', 'اختر صورة اليد') : isGlasses ? t('Choose face photo', 'اختر صورة الوجه') : t('Choose wrist photo', 'اختر صورة المعصم')}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void applyPhoto(f); e.target.value = ''; }} />

      {features.pairing && (
        <Dialog open={qrOpen} onOpenChange={closePair}>
          <DialogContent className="qr-dialog">
            <DialogTitle>{t('Take your try-on to your phone', 'أكمل التجربة على جوالك')}</DialogTitle>
            <DialogDescription>{isBag ? t('Scan the code with your phone camera. Take a photo of you, your hand at your side, and send it to this studio.', 'امسحي الرمز بكاميرا جوالك، ثم التقطي صورة لك ويدك إلى جانبك وأرسليها إلى الاستوديو.') : isEarring ? t('Scan the code with your phone camera. Take a side photo, your ear in view, and send it to this studio.', 'امسحي الرمز بكاميرا جوالك، ثم التقطي صورة جانبية تظهر فيها الأذن وأرسليها إلى الاستوديو.') : isNecklace ? t('Scan the code with your phone camera. Take a front photo and send it to this studio.', 'امسحي الرمز بكاميرا جوالك، ثم التقطي صورة أمامية وأرسليها إلى الاستوديو.') : isRing ? t('Scan the code with your phone camera. Take a photo of your hand and send it to this studio.', 'امسح الرمز بكاميرا جوالك، ثم التقط صورة ليدك وأرسلها إلى الاستوديو.') : isGlasses ? t('Scan the code with your phone camera. Take a selfie and send it to this studio.', 'امسح الرمز بكاميرا جوالك، ثم التقط صورة لوجهك وأرسلها إلى الاستوديو.') : t('Scan the code with your phone camera. Take a wrist photo and send it to this studio.', 'امسح الرمز بكاميرا جوالك، ثم التقط صورة لمعصمك وأرسلها إلى الاستوديو.')}</DialogDescription>
            <div className="qr-box">
              {pairBusy ? <LoaderCircle className="spin" /> : pairError ? <p>{pairError}</p> : qrImage ? <img src={qrImage} alt={isGlasses || isRing || isNecklace || isBag || isEarring ? t('Scan to send your photo', 'امسح الرمز لإرسال صورتك') : t('Scan to send your wrist photo', 'امسح الرمز لإرسال صورة معصمك')} /> : <LoaderCircle className="spin" />}
            </div>
            {pairError ? (
              <button className="primary-button" onClick={() => { if (pair) void fetch(`/api/pair/${pair.id}`, { method: 'DELETE' }); setPair(null); void startPair(); }}>{t('Create a new code', 'إنشاء رمز جديد')}</button>
            ) : (
              <p className="qr-status"><LoaderCircle size={14} className="spin" />{t('Waiting for your photo', 'بانتظار صورتك')}</p>
            )}
            {pair && !pairError && <a className="text-button" href={`/capture/${pair.id}`} target="_blank" rel="noreferrer">{t('Open capture page', 'فتح صفحة التصوير')}</a>}
            <p className="privacy-note">{t('Valid for 30 minutes — send as many photos as you like. Each is removed after this browser receives it.', 'صالح لمدة ٣٠ دقيقة — أرسل ما شئت من الصور. تُحذف كل صورة بعد استلامها هنا.')}</p>
          </DialogContent>
        </Dialog>
      )}

      {/* T140.1: the comparison — the same photo twice, this product and the one chosen, each at its real size */}
      <Dialog open={compareOpen} onOpenChange={setCompareOpen}>
        <DialogContent className="help-dialog compare-dialog" showCloseButton={false}>
          <div className="help-head">
            <DialogTitle>{t('Compare on your photo', 'قارن على صورتك')}</DialogTitle>
            <DialogClose className="help-close" aria-label={t('Close', 'إغلاق')}><X size={18} aria-hidden /></DialogClose>
          </div>
          <DialogDescription className="sr-only">{t('Your photo with each product at its real size.', 'صورتك مع كل منتج بمقاسه الحقيقي.')}</DialogDescription>
          {choices[compareTo] && (
            <div className="compare-pair">
              {[{ p: product, page: null as string | null }, { p: choices[compareTo]!.product, page: choices[compareTo]!.page }].map(({ p, page }, i) => (
                <figure key={i} className="compare-half">
                  <canvas ref={(el) => { compareHalves.current[i] = el; }} aria-label={t(p.name.en, p.name.ar)} />
                  <figcaption>
                    <strong>{t(p.name.en, p.name.ar)}</strong>
                    <span dir="ltr">{p.caseMm} {t('mm', 'مم')}</span>
                    {page && <a href={page} target="_top" rel="noopener" className="compare-page"><ExternalLink size={13} aria-hidden />{t('Open its page', 'افتح صفحتها')}</a>}
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
          {choices.length > 1 && (
            <div className="my-photos compare-choices" role="group" aria-label={t('Compare with', 'قارن مع')}>
              {choices.map((c, i) => (
                <span key={c.ref} className={'my-photo' + (i === compareTo ? ' selected' : '')}>
                  <button type="button" onClick={() => setCompareTo(i)} aria-pressed={i === compareTo} aria-label={t(c.product.name.en, c.product.name.ar)}><img src={asset(c.product.flat)} alt="" onError={() => { setCompareBroken((b) => [...b, c.ref]); setCompareTo(0); }} /></button>
                </span>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={helpOpen} onOpenChange={setHelpOpen}>
        {/* T137 (Nader): on a phone it closes easily — a sticky bar with the title and a clear close, the rest scrolls, «حسنًا» at its foot */}
        <DialogContent className="help-dialog" showCloseButton={false}>
          <div className="help-head">
            <DialogTitle>{isEarring ? t('A closer look', 'طرق تجربة قرطك') : isBag ? t('A closer look', 'طرق تجربة حقيبتك') : isNecklace ? t('A closer look', 'طرق تجربة قلادتك') : isRing ? t('A closer look', 'طرق تجربة خاتمك') : isGlasses ? t('A closer look', 'طرق تجربة نظارتك') : t('A closer look, in three ways', 'ثلاث طرق لتجربة ساعتك')}</DialogTitle>
            <DialogClose className="help-close" aria-label={t('Close', 'إغلاق')}><X size={18} aria-hidden /></DialogClose>
          </div>
          <DialogDescription>{isEarring ? t('Explore the earring from every perspective.', 'اكتشف القرط بالطريقة التي تناسبك.') : isBag ? t('Explore the bag from every perspective.', 'اكتشف الحقيبة بالطريقة التي تناسبك.') : isNecklace ? t('Explore the necklace from every perspective.', 'اكتشف القلادة بالطريقة التي تناسبك.') : isRing ? t('Explore the ring from every perspective.', 'اكتشف الخاتم بالطريقة التي تناسبك.') : isGlasses ? t('Explore the glasses from every perspective.', 'اكتشف النظارة بالطريقة التي تناسبك.') : t('Explore the watch from every perspective.', 'اكتشف الساعة بالطريقة التي تناسبك.')}</DialogDescription>
          <div className="help-steps">
            <div><Hand /><div><strong>{t('On model', 'على النموذج')}</strong><p>{isEarring ? t('The earring hangs from a real ear at its real size. Drag it and adjust its size.', 'يتدلى القرط من أذن حقيقية بحجمه الحقيقي. حرّكه وعدّل حجمه.') : isBag ? t('The bag is carried by a real model at its real size.', 'تحمل الحقيبةَ عارضةٌ حقيقية بحجمها الحقيقي.') : isNecklace ? t('The necklace hangs on a real model at its real size. Drag it and adjust its size.', 'تتدلى القلادة على عارضة حقيقية بحجمها الحقيقي. حرّكها وعدّل حجمها.') : isRing ? t('The ring sits on a real hand at its real width. Drag it along the finger and adjust its size or angle.', 'يظهر الخاتم على يد حقيقية بعرضه الحقيقي. حرّكه على الإصبع وعدّل حجمه وزاويته.') : isGlasses ? t('The frame sits on a real face at its real width. Drag it and adjust its size or angle.', 'يظهر الإطار على وجه حقيقي بعرضه الحقيقي. حرّكه وعدّل حجمه وزاويته.') : t('Choose a close-up or lifestyle photo. Drag the watch along the wrist and adjust its size or angle.', 'اختر صورة المعصم أو الإطلالة اليومية. حرّك الساعة على المعصم وعدّل حجمها وزاويتها.')}</p></div></div>
            <div><Camera /><div><strong>{t('On me', 'عليّ')}</strong><p>{isBag ? t('Upload a photo of you with your hand down at your side. We find your hand automatically, on this device, and hang the bag from it at its real size, sized from your hand; use Fit to hand to tap your wrist and your middle finger’s knuckle if needed.', 'ارفعي صورة لك ويدك منسدلة إلى جانبك. نحدد يدك تلقائيًا على جهازك ونعلّق الحقيبة منها بحجمها الحقيقي، والمقياس من طول الكف، ويمكنك تحديد المعصم ومفصل الإصبع الوسطى باستخدام ضبط على اليد.') : isEarring ? t('Upload a clear side photo with your ear in view. Tap the top of your ear, then the bottom of your earlobe: the earring hangs from the lobe at its real size, sized from the ear.', 'ارفعي صورة جانبية واضحة تظهر فيها الأذن. حدّدي أعلى الأذن ثم أسفل الشحمة: يتدلى القرط من الشحمة بحجمه الحقيقي، والمقياس من طول الأذن.') : isNecklace ? t('Upload a clear front photo with your face and chest in view. We find your face automatically, on this device, and hang the necklace below your chin; use Fit to eyes to tap your two pupils if needed.', 'ارفعي صورة أمامية واضحة يظهر فيها الوجه والصدر. نحدد وجهك تلقائيًا على جهازك ونعلّق القلادة تحت الذقن، ويمكنك تحديد الحدقتين باستخدام ضبط على العينين.') : isRing ? t('Upload a clear photo of the back of your hand, fingers apart. We find your ring finger automatically, on this device; use Fit to finger to tap its two sides if needed.', 'ارفع صورة واضحة لظهر يدك والأصابع متباعدة. نحدد البنصر تلقائيًا على جهازك، ويمكنك تحديد جهتيه باستخدام ضبط على الإصبع.') : isGlasses ? t('Upload a clear front photo of your face. We find your eyes automatically, on this device; use Fit to eyes to tap your two pupils if needed.', 'ارفع صورة أمامية واضحة لوجهك. نحدد عينيك تلقائيًا على جهازك، ويمكنك تحديد الحدقتين باستخدام ضبط على العينين.') : t('Upload a clear photo with your whole hand visible. We look for your wrist automatically; use Fit to wrist to mark its two edges if needed.', 'ارفع صورة واضحة تظهر اليد كاملة. نحاول تحديد المعصم تلقائياً، ويمكنك تحديد حافتيه باستخدام ضبط على المعصم.')}</p></div></div>
            <div><Ruler /><div><strong>{t('Compare', 'قارن الحجم')}</strong><p>{t('Compare relative sizes with an iPhone, AirPods or Saudi riyal. Drag either item and rotate it. Zoom scales both together.', 'قارن الحجم مع آيفون أو إيربودز أو ريال سعودي. حرّك أي عنصر ودوّره. التكبير يغيّر حجم العنصرين معاً.')}</p></div></div>
            <p className="privacy-note">{t('Photo-based preview, not a live 3D camera filter. A single photo cannot verify exact physical fit.', 'معاينة باستخدام صورة، وليست فلتر كاميرا ثلاثي الأبعاد. لا يمكن التحقق من المقاس الفعلي الدقيق عبر صورة واحدة.')}</p>
            {helpExtra}
          </div>
          <DialogClose asChild><button type="button" className="primary-button help-ok">{t('Got it', 'حسنًا')}</button></DialogClose>
        </DialogContent>
      </Dialog>

      {/* T137: on a phone, «عليّ» opens the camera with the guide and auto capture; the chosen photo comes back here as it was fitted */}
      {cameraOpen && typeof document !== 'undefined' && createPortal(
        <CameraTryOn product={pairProductOf(product)} brand={null} kind={kindOf(product)} onClose={() => setCameraOpen(false)} shareLink={linkOrHere(shareLink)}
          onUse={(shot) => {
            setCameraOpen(false);
            const fitted = shot.pose ? { x: shot.pose.x / shot.size.width, y: shot.pose.y / shot.size.height, width: shot.pose.width / shot.size.width, angle: shot.pose.angle } : null;
            void applyPhoto(shot.blob, fitted, t('Placed as you set it. Adjust it here if needed.', 'كما ضبطته. عدّله هنا عند الحاجة.'));
          }} />,
        document.body,
      )}

      {notice && (
        <div className="notice" role="status">{notice}
          <button aria-label={t('Dismiss notification', 'إغلاق التنبيه')} onClick={() => setNotice('')}><X size={15} /></button>
        </div>
      )}
    </div>
  );
}
