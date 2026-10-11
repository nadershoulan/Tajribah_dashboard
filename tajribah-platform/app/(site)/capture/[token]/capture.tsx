'use client';

/**
 * The phone side of the QR hand-off — T134.3: the phone *is* the try-on. Full screen, the store's (its name, its logo
 * under white-label — never Tajribah's), the product on the shopper's own hand or face:
 *
 *  - the live camera with the kind's guide (T134.4) and what it sees («اقترب قليلًا», «تم تحديد المعصم»), the product
 *    following the hand as it moves; «التقط» keeps the moment;
 *  - the picture full screen with the product placed at its real size (`site/lib/placement.ts`), moved with a finger,
 *    sized and turned with two; several shots kept as thumbnails;
 *  - «أرسل إلى شاشتي» still sends the photo to the computer that showed the code (as before);
 *  - no camera (refused, or none): the phone's own camera and its photos, as before.
 *
 * Everything is looked at on the phone; nothing leaves it unless the shopper sends it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Camera, Check, ImagePlus, LoaderCircle, Monitor, RefreshCw, Ruler, SwitchCamera, X } from 'lucide-react';
import { preparePhoto } from '@site/lib/photo';
import { useLang } from '@site/lib/i18n';
import { useSiteEnv, SiteLink } from '@site/lib/site-env';
import { StoreMark } from '@site/components/site/store-mark';
import { Guide, guideText, type GuideState } from '@site/components/studio/guides';
import type { Pairing } from '@site/lib/pair-product';
import { cssShadow, type ShadowKind } from '@site/lib/shadow';
import { detectHand } from '@site/lib/hand-detect';
import { detectFace } from '@site/lib/face-detect';
import { POSE_HEADER, poseHeader } from '@site/lib/pair-pose';
import { model } from '@site/lib/detectors';
import { earringPlacement, facePoints, handPoints, placeOnFace, placeOnHand, type Pose, type Pt } from '@site/lib/placement';
import { faceFeedback, follow, handFeedback } from '@site/lib/live-feedback';
import { dragged, fillFor, fitOf, liftedAbove, mirrored, onPicture, onScreen, pinched, type Fit, type Size } from '@site/lib/capture-view';

type Landmark = { x: number; y: number; z?: number };
/** What the detector saw: its points (flipped with the picture when `mirrored`) and its score. */
type Sighting = { landmarks: Landmark[]; score: number; mirrored?: boolean };
/** `fill`: edge to edge, or the whole picture when that would cut off where the product is — chosen once, so it never jumps mid-drag. */
/** `first`: where the product first landed — the photo is slid up from it so the buttons never cover it. */
type Shot = { id: number; dataUrl: string; blob: Blob; size: Size; fill: 'cover' | 'contain'; pose: Pose | null; auto: Pose | null; first: Pose | null; taps: Pt[]; sent: boolean };
type View = 'camera' | 'pick' | 'result';

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const i = new Image(); i.onload = () => resolve(i); i.onerror = () => reject(new Error('image')); i.src = src;
});
const SHADOW: Record<string, ShadowKind> = { watch: 'watch', ring: 'ring', bag: 'bag', glasses: 'eyewear', necklace: 'necklace', earring: 'earring' };
const MAX_SHOTS = 6;
/** Nothing found to measure by: the product starts in the middle at about the share of the picture it usually takes. */
const START_SHARE: Record<string, number> = { watch: 0.22, ring: 0.1, bag: 0.5, glasses: 0.55, necklace: 0.45, earring: 0.08 };

export default function Capture({ token, pairing }: { token: string; pairing: Pairing | null }) {
  const { t, lang, toggle } = useLang();
  const { asset } = useSiteEnv();
  const kind = pairing?.kind ?? 'watch';
  const product = pairing?.product ?? null;
  const brand = pairing?.brand ?? null;
  const onFace = kind === 'glasses' || kind === 'necklace' || kind === 'earring';
  const worn = product ? asset(product.worn) : '';

  const [view, setView] = useState<View>('camera');
  const [camera, setCamera] = useState<'starting' | 'live' | 'off'>('starting');
  const [facing, setFacing] = useState<'environment' | 'user'>(onFace ? 'user' : 'environment');
  const [state, setState] = useState<GuideState>('idle');
  const [shots, setShots] = useState<Shot[]>([]);
  const [current, setCurrent] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [aspect, setAspect] = useState(1);
  const [screen, setScreen] = useState<Size>({ width: 390, height: 844 });

  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const liveProduct = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const nativeCamera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);
  /** The last sighting on the live frame: landmarks as on the (mirrored, when the front camera) picture. */
  const sighting = useRef<Sighting | null>(null);
  const nextId = useRef(1);
  const mirror = facing === 'user';

  const shot = shots.find((s) => s.id === current) ?? null;

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
    if (view !== 'camera' || !pairing) return;
    let cancelled = false;
    setCamera('starting'); setState('idle'); sighting.current = null;
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
  }, [view, facing, pairing, stopCamera]);

  // Look at the live frame a dozen times a second: the guide's state, and the product following the hand or face.
  useEffect(() => {
    if (view !== 'camera' || camera !== 'live') return;
    let stopped = false, frame = 0, last = 0, drawn: Pose | null = null, said: GuideState = 'idle';
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let detector: any = null;
    (onFace ? model('face', 'VIDEO', asset) : model('hand', 'VIDEO', asset)).then((m) => { detector = m; }).catch(() => {});
    const tell = (next: GuideState) => { if (next !== said) { said = next; setState(next); } };
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
          tell(faceFeedback(f, box));
          if (f && product && kind !== 'earring') target = placeOnFace(kind === 'necklace' ? 'necklace' : 'glasses', f, product.caseMm, aspect, mirror);
        } else {
          const result = detector.detectForVideo(v, now);
          const found = result.landmarks?.[0] as Landmark[] | undefined;
          const lm = found ? (mirror ? mirrored(found) : found) : null;
          const h = lm ? handPoints(lm, picture, fit) : null;
          const score = result.handedness?.[0]?.[0]?.score ?? 0.5;
          sighting.current = lm && h ? { landmarks: lm, score, mirrored: mirror } : null;
          const handKind = kind === 'ring' ? 'ring' : kind === 'bag' ? 'bag' : 'watch';
          tell(handFeedback(handKind, h, box));
          if (h && product) target = placeOnHand(handKind, h, product.caseMm, aspect, score);
        }
      } catch { /* a dropped frame */ }
      const el = liveProduct.current;
      if (!el) return;
      if (!target) { drawn = null; el.style.opacity = '0'; return; }
      drawn = follow(drawn, target);
      place(el, drawn, aspect, SHADOW[kind] ?? 'watch');
      el.style.opacity = '1';
    };
    frame = requestAnimationFrame(tick);
    return () => { stopped = true; cancelAnimationFrame(frame); };
  }, [view, camera, onFace, mirror, kind, product, aspect, asset]);

  // ── Shots ─────────────────────────────────────────────────────────────────────────────────────────────────────
  /** Place the product on a still: the live sighting when there is one (the same moment), else a fresh, harder look. */
  async function placeOn(img: HTMLImageElement, seen: Sighting | null): Promise<{ pose: Pose | null; found: boolean }> {
    const size = { width: img.naturalWidth, height: img.naturalHeight };
    const flat = { scale: 1, ox: 0, oy: 0 };
    if (!product || kind === 'earring') return { pose: null, found: false };
    try {
      if (onFace) {
        let lm = seen?.landmarks ?? null;
        // the live sighting was flipped with the front camera's picture; a fresh look at the (flipped) still is not
        const flipped = !!lm && seen?.mirrored === true;
        if (!lm) lm = ((await detectFace(await model('face', 'IMAGE', asset), img))?.faceLandmarks[0] as Landmark[] | undefined) ?? null;
        const f = lm ? facePoints(lm, size, flat) : null;
        return f ? { pose: placeOnFace(kind === 'necklace' ? 'necklace' : 'glasses', f, product.caseMm, aspect, flipped), found: true } : { pose: null, found: false };
      }
      let lm = seen?.landmarks ?? null, score = seen?.score ?? 0.5;
      if (!lm) {
        const found = await detectHand(await model('hand', 'IMAGE', asset), img);
        if (found) { lm = found.landmarks[0] ?? null; score = found.score; }
      }
      const h = lm ? handPoints(lm, size, flat) : null;
      const handKind = kind === 'ring' ? 'ring' : kind === 'bag' ? 'bag' : 'watch';
      return h ? { pose: placeOnHand(handKind, h, product.caseMm, aspect, score), found: true } : { pose: null, found: false };
    } catch {
      return { pose: null, found: false };
    }
  }

  async function keep(blob: Blob, seen: Sighting | null) {
    setBusy(true); setError('');
    try {
      const prepared = await preparePhoto(blob);
      const img = await loadImage(prepared.dataUrl);
      const size = { width: img.naturalWidth, height: img.naturalHeight };
      const { pose, found } = await placeOn(img, seen);
      // nothing found: the product in the middle at about its usual share of the picture, to be moved by hand
      const start = pose ?? (product && kind !== 'earring' ? { x: size.width / 2, y: size.height / 2, width: size.width * (START_SHARE[kind] ?? 0.22), angle: 0 } : null);
      const fill = fillFor(screen, size, start);
      const next: Shot = { id: nextId.current++, dataUrl: prepared.dataUrl, blob: prepared.blob, size, fill, pose: start, auto: pose, first: start, taps: [], sent: false };
      setShots((was) => [...was, next].slice(-MAX_SHOTS));
      setCurrent(next.id);
      setView('result');
      if (kind === 'earring' && product) setNote(t('اضغط أعلى أذنك، ثم أسفل شحمة الأذن', 'Tap the top of your ear, then the bottom of your earlobe'));
      else if (product && !found) setNote(t('حرّك المنتج بإصبعك إلى مكانه، وكبّره أو صغّره بإصبعين', 'Drag the product into place; pinch to size and turn it'));
    } catch {
      setError(t('تعذّر فتح الصورة. اختر JPG أو PNG أو WebP أقل من 20 ميجابايت.', 'This photo could not be opened. Choose a JPG, PNG or WebP under 20 MB.'));
    } finally { setBusy(false); }
  }

  async function capture() {
    const v = video.current;
    if (!v || !v.videoWidth || busy) return;
    const seen = sighting.current;
    const c = document.createElement('canvas');
    c.width = v.videoWidth; c.height = v.videoHeight;
    const g = c.getContext('2d')!;
    if (mirror) { g.translate(c.width, 0); g.scale(-1, 1); } // what the shopper saw, as in a mirror
    g.drawImage(v, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, 'image/jpeg', 0.9));
    if (blob) await keep(blob, seen);
  }

  function choose(f: File | undefined) { if (f) void keep(f, null); }

  function update(id: number, change: (s: Shot) => Shot) { setShots((was) => was.map((s) => (s.id === id ? change(s) : s))); }

  function remove(id: number) {
    const left = shots.filter((s) => s.id !== id);
    setShots(left);
    if (current === id) setCurrent(left.at(-1)?.id ?? null);
    if (!left.length) setView(camera === 'off' ? 'pick' : 'camera');
  }

  async function send() {
    if (!shot || busy) return;
    setBusy(true); setError('');
    try {
      // T134.7: with where the shopper left the product, so the computer shows the same picture
      const fitted: Record<string, string> = product && shot.pose ? { [POSE_HEADER]: poseHeader(shot.pose, shot.size) } : {};
      const r = await fetch(`/api/pair/${token}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg', ...fitted }, body: shot.blob });
      if (!r.ok) throw Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? '');
      update(shot.id, (s) => ({ ...s, sent: true }));
      setNote(t('أُرسلت إلى شاشتك', 'Sent to your screen'));
    } catch (e) {
      setError(ended(e) ? t('انتهت هذه الجلسة. امسح رمزًا جديدًا لإرسال الصورة.', 'This session has ended. Scan a new code to send the photo.') : t('تعذّر الإرسال. حاول مجددًا.', 'Could not send. Try again.'));
    } finally { setBusy(false); }
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
    if (kind === 'earring' && product && shot.taps.length < 2) {
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

  // ── The page ──────────────────────────────────────────────────────────────────────────────────────────────────
  if (!pairing) {
    return (
      <main className="cap cap-ended" dir={lang === 'ar' ? 'rtl' : 'ltr'}>
        <div className="cap-ended-card">
          <h1>{t('انتهت هذه الجلسة', 'This session has ended')}</h1>
          <p>{t('عُد إلى الشاشة الأخرى وامسح رمزًا جديدًا.', 'Go back to your other screen and scan a new code.')}</p>
        </div>
      </main>
    );
  }

  const top = (
    <header className="cap-top">
      <span className="cap-brand">{brand ? <StoreMark brand={brand} /> : product ? t(product.name.ar, product.name.en) : null}</span>
      <button type="button" className="cap-chip" onClick={toggle} lang={lang === 'ar' ? 'en' : 'ar'}>{lang === 'ar' ? 'EN' : 'ع'}</button>
    </header>
  );

  return (
    <main className={`cap cap-${view}`} dir={lang === 'ar' ? 'rtl' : 'ltr'} data-kind={kind}>
      {view === 'camera' && (
        <>
          <video ref={video} className={'cap-video' + (mirror ? ' cap-mirror' : '')} playsInline muted autoPlay aria-label={t('الكاميرا', 'Camera')} />
          <Guide kind={kind} state={state} className="cap-guide" />
          {product && (
            <div ref={liveProduct} className="cap-live-product" style={{ opacity: 0 }} aria-hidden>
              <img src={worn} alt="" draggable={false} />
            </div>
          )}
          {top}
          <div className="cap-bottom">
            <p className={`cap-say cap-say-${state}`} role="status" aria-live="polite">
              {camera === 'starting' ? t('جارٍ تشغيل الكاميرا…', 'Starting the camera…') : <>{state === 'ready' && <Check size={16} aria-hidden />}{guideText(kind, state, t)}</>}
            </p>
            <div className="cap-controls">
              <button type="button" className="cap-round" onClick={() => gallery.current?.click()} aria-label={t('اختر من الصور', 'Choose from photos')}><ImagePlus size={22} /></button>
              <button type="button" className={`cap-shutter${state === 'ready' ? ' is-ready' : ''}`} onClick={() => void capture()} disabled={camera !== 'live' || busy} aria-label={t('التقط', 'Take the photo')}>
                {busy ? <LoaderCircle className="spin" size={26} /> : <span />}
              </button>
              <button type="button" className="cap-round" onClick={() => setFacing((f) => (f === 'user' ? 'environment' : 'user'))} aria-label={t('بدّل الكاميرا', 'Switch camera')}><SwitchCamera size={22} /></button>
            </div>
            {!shots.length && <Privacy t={t} />}
            {shots.length > 0 && (
              <button type="button" className="cap-back-to" onClick={() => setView('result')}>{t(`صورك (${shots.length})`, `Your photos (${shots.length})`)}</button>
            )}
          </div>
        </>
      )}

      {view === 'pick' && (
        <>
          {top}
          <div className="cap-pick">
            <Guide kind={kind} className="cap-guide-still" />
            <p className="cap-say">{guideText(kind, 'idle', t)}</p>
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
          <div ref={stage} className="cap-stage" onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>
            <img className="cap-photo" src={shot.dataUrl} alt={t('صورتك', 'Your photo')} draggable={false}
              style={{ left: fit.ox, top: fit.oy, width: shot.size.width * fit.scale, height: shot.size.height * fit.scale }} />
            {product && shot.pose && <Placed pose={onScreen(shot.pose, fit)} aspect={aspect} kind={SHADOW[kind] ?? 'watch'} src={worn} alt={t(product.name.ar, product.name.en)} />}
            {kind === 'earring' && shot.taps.length < 2 && shot.taps.map((p, i) => (
              <span key={i} className="cap-tap" style={{ left: fit.ox + p.x * fit.scale, top: fit.oy + p.y * fit.scale }} />
            ))}
          </div>
          {top}
          <div className="cap-sheet" ref={sheet}>
            {product && (
              <div className="cap-sheet-head">
                <strong>{t(product.name.ar, product.name.en)}</strong>
                <span><Ruler size={13} aria-hidden /> {sizeLine}</span>
                {trueSize && <button type="button" className="cap-link" onClick={() => update(shot.id, (s) => ({ ...s, pose: s.pose && s.auto ? { ...s.pose, width: s.auto.width } : s.pose }))}>{t('أعد المقاس الحقيقي', 'Back to real size')}</button>}
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
            <div className="cap-actions">
              <button type="button" className="cap-secondary" onClick={() => setView(camera === 'off' ? 'pick' : 'camera')}><Camera size={17} /> {t('صورة أخرى', 'Another photo')}</button>
              <button type="button" className={product ? 'cap-secondary' : 'cap-primary'} disabled={busy || shot.sent} onClick={() => void send()}>
                {busy ? <LoaderCircle className="spin" size={17} /> : shot.sent ? <Check size={17} /> : <Monitor size={17} />} {shot.sent ? t('على شاشتك', 'On your screen') : t('أرسل إلى شاشتي', 'Send to my screen')}
              </button>
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
