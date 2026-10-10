'use client';

/**
 * T134.6 — «اضبط الموضع»: the store sets where its product sits on each model photo of «جرّبه كما يراه المتسوّق». Drag the
 * product into place, turn it, size it (100 % is its real size — said when it is not); drag the frame's corners to
 * mark the zone a shopper can move it in (its middle moves the frame). «احفظ الموضع» keeps it for that photo;
 * «أعد الوضع التلقائي» gives the photo back its built-in place. Saved, it reloads here and stays editable
 * (memory `never-hide-edit-after-save`), the preview below shows it, and a published product is updated in the shop.
 */
import { useEffect, useRef, useState } from 'react';
import { Crosshair, LoaderCircle, RotateCcw, Save, X } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { useData } from '@/lib/data';
import { useWriteLock } from '@/components/dashboard/write-lock';
import { DEFAULT_ZONES, STAGE, modelsFor, type ModelPhoto, type TryOnProduct } from '@site/lib/demo-product';
import { SCALE, dragZone, inZone, type ModelSpot, type Placement, type ZoneHandle } from '@/lib/tryon-placement';
import type { TryOnKind } from '@/lib/tryon';

const CATEGORY: Record<TryOnKind, TryOnProduct['category']> = { watch: undefined, glasses: 'eyewear', ring: 'ring', necklace: 'necklace', earring: 'earring', bag: 'bag' };
/** Corners only: a wrist's zone is thin, and handles at its edges' middles would sit under the product and catch it. */
const HANDLES: ZoneHandle[] = ['nw', 'ne', 'se', 'sw'];
const pct = (n: number, of: number) => `${(n / of) * 100}%`;

/** The photo's own place: its built-in zone and pose at the product's real size. */
const builtIn = (m: ModelPhoto): ModelSpot => ({ zone: DEFAULT_ZONES[m.id], pose: { x: m.pose.x, y: m.pose.y, angle: m.pose.angle, scale: 1 } });

type Props = { productId: string; kind: TryOnKind; worn: string; caseMm: number; saved: Placement | null; onSaved: () => void; onClose: () => void };

export function PlacementEditor({ productId, kind, worn, caseMm, saved, onSaved, onClose }: Props) {
  const { t, pick } = useLang();
  const source = useData();
  const lock = useWriteLock();
  const { models, baseMm } = modelsFor({ category: CATEGORY[kind] } as TryOnProduct);
  const [at, setAt] = useState(0);
  const model = models[Math.min(at, models.length - 1)]!;
  const [draft, setDraft] = useState<Placement>(saved ?? {});
  const [aspect, setAspect] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<{ what: 'product' | ZoneHandle; x: number; y: number; start: ModelSpot } | null>(null);

  // saved again (here or elsewhere): what is shown is what is stored
  const savedKey = JSON.stringify(saved ?? {});
  useEffect(() => { setDraft(saved ?? {}); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [savedKey]);
  useEffect(() => {
    let live = true;
    const img = new Image();
    img.onload = () => { if (live && img.naturalWidth) setAspect(img.naturalHeight / img.naturalWidth); };
    img.src = worn;
    return () => { live = false; };
  }, [worn]);
  useEffect(() => { if (!done) return; const id = setTimeout(() => setDone(''), 5000); return () => clearTimeout(id); }, [done]);

  const spot = draft[model.id] ?? builtIn(model);
  const isSaved = !!saved?.[model.id];
  const changed = JSON.stringify(draft[model.id] ?? null) !== JSON.stringify(saved?.[model.id] ?? null);
  const trueWidth = (model.pose.width * caseMm) / baseMm;
  const width = trueWidth * spot.pose.scale;
  const height = width * aspect;
  const set = (next: ModelSpot) => { setDraft((d) => ({ ...d, [model.id]: next })); setError(''); };

  /** Screen pixels to stage pixels. */
  const toStage = (px: number) => (px * STAGE.W) / (stage.current?.getBoundingClientRect().width || STAGE.W);
  function start(e: React.PointerEvent, what: 'product' | ZoneHandle) {
    e.preventDefault(); e.stopPropagation();
    (e.currentTarget as Element).setPointerCapture(e.pointerId);
    drag.current = { what, x: e.clientX, y: e.clientY, start: spot };
  }
  function move(e: React.PointerEvent) {
    const d = drag.current;
    if (!d) return;
    const dx = toStage(e.clientX - d.x), dy = toStage(e.clientY - d.y);
    if (d.what === 'product') {
      set({ ...d.start, pose: { ...d.start.pose, ...inZone({ x: d.start.pose.x + dx, y: d.start.pose.y + dy }, d.start.zone) } });
    } else {
      const zone = dragZone(d.start.zone, d.what, dx, dy);
      set({ zone, pose: { ...d.start.pose, ...inZone(d.start.pose, zone) } }); // the product stays inside its zone
    }
  }
  const end = () => { drag.current = null; };
  function nudge(e: React.KeyboardEvent) {
    const step = e.shiftKey ? 10 : 2;
    const by: Record<string, [number, number]> = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    const m = by[e.key];
    if (!m) return;
    e.preventDefault();
    set({ ...spot, pose: { ...spot.pose, ...inZone({ x: spot.pose.x + m[0], y: spot.pose.y + m[1] }, spot.zone) } });
  }

  async function save(next: Placement) {
    setBusy(true); setError('');
    try {
      await source.updateTryOn(productId, { placement: Object.keys(next).length ? next : null });
      setDone(t('حُفظ — والمعاينة أدناه تعرضه، ويُحدَّث في متجرك إن كان منشورًا.', 'Saved — the preview below shows it, and your shop is updated if it is published.'));
      onSaved();
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('تعذّر الحفظ. حاول مجددًا.', 'Could not save. Try again.'));
    } finally { setBusy(false); }
  }
  const saveThis = () => void save({ ...(saved ?? {}), [model.id]: spot });
  const resetThis = () => {
    const next = { ...(saved ?? {}) };
    delete next[model.id];
    setDraft((d) => { const n = { ...d }; delete n[model.id]; return n; });
    void save(next);
  };

  const scalePct = Math.round(spot.pose.scale * 100);
  return (
    <div className="pz" role="group" aria-label={t('اضبط الموضع', 'Set the placement')}>
      <div className="pz-head">
        <strong><Crosshair size={15} aria-hidden /> {t('اضبط الموضع', 'Set the placement')}</strong>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label={t('إغلاق', 'Close')}><X size={15} aria-hidden /></button>
      </div>
      <p className="hint">{t('اسحب المنتج إلى مكانه، واسحب زوايا الإطار لتحدد أين يبقى حين يحرّكه المتسوّق.', 'Drag the product into place, and drag the frame’s corners to mark where it stays when a shopper moves it.')}</p>
      {models.length > 1 && (
        <div className="pz-models" role="group" aria-label={t('صورة النموذج', 'Model photo')}>
          {models.map((m, i) => (
            <button key={m.id} type="button" className={'pz-model' + (i === at ? ' is-on' : '')} aria-pressed={i === at} onClick={() => setAt(i)}>
              <img src={m.thumb} alt="" /> <span>{pick(m.label)}</span>{saved?.[m.id] && <em>{t('مضبوط', 'Set')}</em>}
            </button>
          ))}
        </div>
      )}
      <div className="pz-stage" ref={stage} onPointerMove={move} onPointerUp={end} onPointerCancel={end} data-model={model.id}>
        <img className="pz-photo" src={model.src} alt={pick(model.label)} draggable={false} />
        <div className="pz-zone" style={{ left: pct(spot.zone.x, STAGE.W), top: pct(spot.zone.y, STAGE.H), width: pct(spot.zone.w, STAGE.W), height: pct(spot.zone.h, STAGE.H) }}
          onPointerDown={(e) => start(e, 'move')} aria-hidden />
        <img className="pz-product" src={worn} alt={t('المنتج — اسحبه إلى مكانه', 'The product — drag it into place')} draggable={false} tabIndex={0} onKeyDown={nudge}
          onPointerDown={(e) => start(e, 'product')}
          data-pose={`${spot.pose.x},${spot.pose.y},${Math.round(width)},${spot.pose.angle}`}
          style={{ left: pct(spot.pose.x - width / 2, STAGE.W), top: pct(spot.pose.y - height / 2, STAGE.H), width: pct(width, STAGE.W), transform: `rotate(${spot.pose.angle}deg)` }} />
        {model.front && <img className="pz-photo pz-front" src={model.front} alt="" draggable={false} />}
        <div className="pz-handles" style={{ left: pct(spot.zone.x, STAGE.W), top: pct(spot.zone.y, STAGE.H), width: pct(spot.zone.w, STAGE.W), height: pct(spot.zone.h, STAGE.H) }}
          data-zone={`${spot.zone.x},${spot.zone.y},${spot.zone.w},${spot.zone.h}`}>
          {HANDLES.map((h) => <span key={h} className={`crop-handle is-${h}`} data-handle={h} onPointerDown={(e) => start(e, h)} aria-hidden />)}
        </div>
      </div>
      <div className="pz-controls">
        <label>
          <span>{t('الحجم', 'Size')}: <b className="num">{scalePct}%</b> {scalePct === 100 ? t('— مقاسه الحقيقي', '— its real size') : t('من مقاسه الحقيقي', 'of its real size')}</span>
          <input type="range" min={SCALE.min * 100} max={SCALE.max * 100} step={1} value={scalePct}
            onChange={(e) => set({ ...spot, pose: { ...spot.pose, scale: Number(e.target.value) / 100 } })} />
        </label>
        <label>
          <span>{t('الدوران', 'Angle')}: <b className="num" dir="ltr">{Math.round(spot.pose.angle)}°</b></span>
          <input type="range" min={-180} max={180} step={1} value={Math.round(spot.pose.angle)}
            onChange={(e) => set({ ...spot, pose: { ...spot.pose, angle: Number(e.target.value) } })} />
        </label>
      </div>
      {scalePct !== 100 && <p className="hint">{t('المقاس الحقيقي هو ما يعد به المتسوّق؛ غيّره فقط إن كانت صورة المنتج أكبر أو أصغر من حدوده.', 'The real size is what the shopper is promised; change it only if the product’s picture is larger or smaller than its edges.')}</p>}
      <div className="pz-actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || lock.locked || !changed} onClick={saveThis}>
          {busy ? <LoaderCircle size={15} className="spin" aria-hidden /> : <Save size={15} aria-hidden />}{t('احفظ الموضع', 'Save the placement')}
        </button>
        {(isSaved || changed) && (
          <button type="button" className="btn btn-ghost btn-sm" disabled={busy || lock.locked} onClick={resetThis}>
            <RotateCcw size={15} aria-hidden />{t('أعد الوضع التلقائي', 'Back to the automatic place')}
          </button>
        )}
        <span className="hint" role="status" style={{ margin: 0 }}>
          {done || (isSaved ? (changed ? t('تغييرات لم تُحفظ', 'Unsaved changes') : t('مضبوط لهذه الصورة', 'Set for this photo')) : changed ? t('تغييرات لم تُحفظ', 'Unsaved changes') : t('الوضع التلقائي', 'The automatic place'))}
        </span>
      </div>
      {error && <p className="field-error" role="alert">{error}</p>}
    </div>
  );
}
