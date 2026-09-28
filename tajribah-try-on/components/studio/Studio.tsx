'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Camera, Check, ChevronRight, Download, Expand, Hand, HelpCircle, ImagePlus, LoaderCircle,
  Maximize2, Minus, Move, Plus, QrCode, RotateCcw, Ruler, Smartphone, Upload, X,
} from 'lucide-react';
import QRCode from 'qrcode';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useLang } from '@/lib/i18n';
import { useSiteEnv } from '@/lib/site-env';
import { preparePhoto } from '@/lib/photo';
import {
  DEMO_WATCH, MODELS, PX_PER_MM, REFERENCES, STAGE, constrainToModel,
  type ModelId, type Pose, type ReferenceId, type TryOnProduct,
} from '@/lib/demo-product';

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

  const [mode, setMode] = useState<Mode>('model');
  const [model, setModel] = useState(0);
  // On the model photos the poses are tuned to the demo watch; another watch is drawn in
  // proportion to its case width, so the size shown is true (Nader, 2026-09-28). The demo: factor 1.
  const modelPose = (i: number): Pose => {
    const k = product.caseMm / DEMO_WATCH.caseMm;
    return k === 1 ? { ...MODELS[i].pose } : { ...MODELS[i].pose, width: MODELS[i].pose.width * k };
  };
  const [pose, setPose] = useState<Pose>(modelPose(0));
  const [scale, setScale] = useState(100);
  const [zoom, setZoom] = useState(1);
  const [units, setUnits] = useState('mm');
  const [rulers, setRulers] = useState(true);
  const [ref, setRef] = useState<ReferenceId>('iphone');
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
  const needed = mode === 'model' ? [model ? 'lifestyle' : 'wrist', 'watch'] : mode === 'compare' ? ['flat', ref] : ['watch'];
  const assetsReady = needed.every((key) => loaded.has(key));
  const [assetError, setAssetError] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [isPhone, setIsPhone] = useState(false);

  const canvas = useRef<HTMLCanvasElement>(null);
  const file = useRef<HTMLInputElement>(null);
  const images = useRef<Record<string, HTMLImageElement>>({});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handDetector = useRef<any>(null);
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
    const first: Record<string, string> = { wrist: MODELS[0].src, watch: product.worn };
    const later: Record<string, string> = { lifestyle: MODELS[1].src, flat: product.flat };
    for (const id of REF_IDS) later[id] = REFERENCES[id].src;
    const load = (paths: Record<string, string>) => Promise.all(Object.entries(paths).map(async ([key, url]) => {
      const image = await loadImage(asset(url));
      if (live) { images.current[key] = image; setLoaded((was) => new Set(was).add(key)); }
    }));
    load(first).then(() => load(later)).catch(() => { if (live) setAssetError(true); });
    return () => { live = false; };
  }, [asset, product.worn, product.flat]);
  useEffect(() => () => handDetector.current?.close(), []);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { setExpanded(false); setCalibrating(false); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, []);

  function reset(nextMode: Mode = mode, nextModel = model) {
    setScale(100); setZoom(1); setCalibrating(false); setPoints([]); setActive('watch');
    setPose(
      nextMode === 'model' ? modelPose(nextModel)
        : nextMode === 'compare' ? { x: 365, y: 550, width: product.caseMm * PX_PER_MM, angle: 0 }
          : { ...photoFit },
    );
    setRefPose({ x: 790, y: 550, angle: 0 });
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
          <div className="product-image">
            <img src={asset(product.worn)} alt={t(product.alt.en, product.alt.ar)} />
          </div>
          <div className="product-detail"><span>{t('Reference', 'رقم المنتج')}</span><strong dir="ltr">{product.sku}</strong></div>
          <div className="product-detail"><span>{t('Approx. case width', 'عرض العلبة التقريبي')}</span><strong dir="ltr">{measure(product.caseMm)}</strong></div>
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

        <section className="studio-panel" aria-label={t('Watch try-on studio', 'استوديو تجربة الساعة')}>
          <div className="studio-topbar">
            <Tabs value={mode} onValueChange={changeMode}>
              <TabsList className="mode-tabs">
                <TabsTrigger value="model"><Hand size={17} />{t('On model', 'على النموذج')}</TabsTrigger>
                <TabsTrigger value="me"><Camera size={17} />{t('On me', 'عليّ')}</TabsTrigger>
                <TabsTrigger value="compare"><Ruler size={17} />{t('Compare', 'قارن الحجم')}</TabsTrigger>
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
                  aria-label={t('Interactive watch preview. Drag to position. Use arrow keys for precise movement.', 'معاينة الساعة. اسحب لتغيير موضعها أو استخدم مفاتيح الأسهم.')}
                  onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerEnd} onPointerCancel={pointerEnd}
                  onLostPointerCapture={pointerEnd} onKeyDown={keyMove} className={calibrating ? 'calibrating' : ''} />
                {!assetsReady && (
                  <div className="stage-loading">
                    {assetError ? (<><span>{t('Images could not load.', 'تعذر تحميل الصور.')}</span>
                      <button className="text-button" onClick={() => window.location.reload()}>{t('Reload', 'إعادة التحميل')}</button></>)
                      : <LoaderCircle className="spin" />}
                  </div>
                )}
                {photoBusy && <div className="detecting"><LoaderCircle size={16} className="spin" />{t('Finding your wrist…', 'جارٍ تحديد المعصم…')}</div>}
                {calibrating && (
                  <div className="calibration-prompt">
                    <span>{points.length ? t('2. Tap the opposite edge of your wrist', '٢. حدد الحافة المقابلة من المعصم') : t('1. Tap one edge of your wrist', '١. حدد إحدى حافتي المعصم')}</span>
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
                <h2>{t('Your wrist. Your watch.', 'معصمك. ساعتك.')}</h2>
                <p>{t('See how it looks on you with a photo of your wrist.', 'شاهد كيف تبدو الساعة عليك باستخدام صورة لمعصمك.')}</p>
                <button className="primary-button" onClick={() => (isPhone ? file.current?.click() : features.pairing ? setQrOpen(true) : file.current?.click())}>
                  {isPhone ? <Camera size={18} /> : features.pairing ? <Smartphone size={18} /> : <Upload size={18} />}
                  {isPhone ? t('Take a wrist photo', 'التقط صورة لمعصمك')
                    : features.pairing ? t('Continue on your phone', 'أكمل التجربة من جوالك')
                      : t('Upload a wrist photo', 'ارفع صورة لمعصمك')}
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
                        onClick={() => { setRef(n); setRefPose({ x: 790, y: 550, angle: 0 }); }}>
                        <img src={asset(REFERENCES[n].src)} alt="" /><span>{t(REFERENCES[n].name.en, REFERENCES[n].name.ar)}</span>
                      </button>
                    ))}
                  </div>
                </>
              ) : (
                <div className="photo-actions">
                  <button className="secondary-button" onClick={() => file.current?.click()}><ImagePlus size={16} />{photo ? t('Change photo', 'تغيير الصورة') : t('Upload a photo', 'ارفع صورة')}</button>
                  {photo && <button className="secondary-button" onClick={() => { setCalibrating(true); setPoints([]); setZoom(1); }}><Maximize2 size={16} />{t('Fit to wrist', 'ضبط على المعصم')}</button>}
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
                    <div className="adjustment-label"><label id="scale-label">{t('Watch size', 'حجم الساعة')}</label><span dir="ltr">{scale}%</span></div>
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
        <span><Ruler size={15} />{t('A visual guide to fit. Dimensions and placement are approximate.', 'دليل مرئي للمقاس. الأبعاد وموضع الساعة تقريبيان.')}</span>
        {showCanvas && features.download && (
          <button className="download-button" onClick={saveImage} disabled={!assetsReady || photoBusy}><Download size={16} />{t('Save your look', 'احفظ إطلالتك')}</button>
        )}
      </footer>

      <input ref={file} type="file" accept="image/jpeg,image/png,image/webp,image/heic,image/heif" capture={isPhone ? 'environment' : undefined}
        className="sr-only" aria-label={t('Choose wrist photo', 'اختر صورة المعصم')}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void applyPhoto(f); e.target.value = ''; }} />

      {features.pairing && (
        <Dialog open={qrOpen} onOpenChange={closePair}>
          <DialogContent className="qr-dialog">
            <DialogTitle>{t('Take your try-on to your phone', 'أكمل التجربة على جوالك')}</DialogTitle>
            <DialogDescription>{t('Scan the code with your phone camera. Take a wrist photo and send it to this studio.', 'امسح الرمز بكاميرا جوالك، ثم التقط صورة لمعصمك وأرسلها إلى الاستوديو.')}</DialogDescription>
            <div className="qr-box">
              {pairBusy ? <LoaderCircle className="spin" /> : pairError ? <p>{pairError}</p> : qrImage ? <img src={qrImage} alt={t('Scan to send your wrist photo', 'امسح الرمز لإرسال صورة معصمك')} /> : <LoaderCircle className="spin" />}
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
          <DialogTitle>{t('A closer look, in three ways', 'ثلاث طرق لتجربة ساعتك')}</DialogTitle>
          <DialogDescription>{t('Explore the watch from every perspective.', 'اكتشف الساعة بالطريقة التي تناسبك.')}</DialogDescription>
          <div className="help-steps">
            <div><Hand /><div><strong>{t('On model', 'على النموذج')}</strong><p>{t('Choose a close-up or lifestyle photo. Drag the watch along the wrist and adjust its size or angle.', 'اختر صورة المعصم أو الإطلالة اليومية. حرّك الساعة على المعصم وعدّل حجمها وزاويتها.')}</p></div></div>
            <div><Camera /><div><strong>{t('On me', 'عليّ')}</strong><p>{t('Upload a clear photo with your whole hand visible. We look for your wrist automatically; use Fit to wrist to mark its two edges if needed.', 'ارفع صورة واضحة تظهر اليد كاملة. نحاول تحديد المعصم تلقائياً، ويمكنك تحديد حافتيه باستخدام ضبط على المعصم.')}</p></div></div>
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
