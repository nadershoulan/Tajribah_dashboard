'use client';

/**
 * T128 — the picture editor: a store photo, the current cut-out or a picture from the merchant's computer, edited in
 * the browser and saved as the try-on's picture (checked like any upload) — or downloaded to the computer.
 *
 * The work is `lib/image-edit.ts` (pure, tested); this file only decodes, draws and wires the controls. Every control
 * comes from `EDITOR_TOOLS`: a toggle, a slider, a one-click action over a field of `Edits`, or click-to-erase (a mode:
 * the preview shows the picture as the store took it, and each click on it adds a spot). **A new tool** is a step
 * in `EDIT_STEPS`, a field in `Edits`, and an entry here — the panel draws itself from the list.
 *
 * The preview is worked on a smaller copy so sliders follow the hand; saving and downloading work on the full picture.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Crop, Download, Eraser, FlipHorizontal2, FlipVertical2, ImageUp, Maximize2, MousePointerClick, Redo2, RotateCcw, RotateCw, Save, SlidersHorizontal, Sparkles, Undo2, X,
  type LucideIcon,
} from 'lucide-react';
import { useLang } from '@/lib/i18n';
import type { Bi } from '@/lib/lang';
import { EDIT_REASONS, EDIT_STEPS, MAX_SPOTS, NO_EDITS, applyEdits, isEdited, resize, type EditResult, type Edits, type Rgba } from '@/lib/image-edit';

/** The longest side the picture is kept at while editing: plenty for the try-on, quick in the browser. */
export const WORK_PX = 1600;
/** The preview's longest side (sliders redraw from this). */
export const PREVIEW_PX = 640;
/** While erasing, the preview is the source with only the erase clicks — what the clicks land on. */
const ERASE_ONLY = EDIT_STEPS.filter((s) => s.id === 'erase');

export type EditorSource = { id: string; label: Bi; thumb?: string; load: () => Promise<Blob>; /** A store photo: start with its background off. */ store?: boolean };

type Group = 'background' | 'crop' | 'turn' | 'light' | 'size';
type Tool =
  | { kind: 'toggle'; key: 'removeBackground' | 'trim' | 'flipX' | 'flipY'; group: Group; label: Bi; icon: LucideIcon; hint?: Bi }
  | { kind: 'slider'; key: 'tolerance' | 'cropTop' | 'cropRight' | 'cropBottom' | 'cropLeft' | 'rotate' | 'brightness' | 'contrast' | 'saturation' | 'scale' | 'padding'; group: Group; label: Bi; min: number; max: number; step: number; unit: string }
  | { kind: 'action'; id: string; group: Group; label: Bi; icon: LucideIcon; apply: (e: Edits) => Partial<Edits> }
  | { kind: 'erase'; group: Group; label: Bi; icon: LucideIcon; hint: Bi };

export const GROUPS: { id: Group; label: Bi; icon: LucideIcon }[] = [
  { id: 'background', label: { ar: 'الخلفية', en: 'Background' }, icon: Eraser },
  { id: 'crop', label: { ar: 'القص', en: 'Crop' }, icon: Crop },
  { id: 'turn', label: { ar: 'التدوير والقلب', en: 'Rotate & flip' }, icon: RotateCw },
  { id: 'light', label: { ar: 'الإضاءة والألوان', en: 'Light & colour' }, icon: SlidersHorizontal },
  { id: 'size', label: { ar: 'الحجم والهامش', en: 'Size & margin' }, icon: Maximize2 },
];

/** Every control the editor shows, in order. Add a tool here (and its step in `lib/image-edit.ts`). */
export const EDITOR_TOOLS: Tool[] = [
  { kind: 'toggle', key: 'removeBackground', group: 'background', label: { ar: 'إزالة الخلفية بنقرة', en: 'Remove background' }, icon: Sparkles, hint: { ar: 'للخلفية البيضاء أو بلون واحد.', en: 'For a white or one-colour background.' } },
  { kind: 'erase', group: 'background', label: { ar: 'امسح بالنقر', en: 'Erase by clicking' }, icon: MousePointerClick, hint: { ar: 'لخلفية ليست بلون واحد (مجسّم عرض، ظل): انقر على ما تريد إزالته في الصورة، وكل نقرة تزيل المنطقة المتصلة بلونها.', en: 'For a background that is not one colour (a display bust, a shadow): click what you want gone in the picture — each click takes the area connected to its colour.' } },
  { kind: 'slider', key: 'tolerance', group: 'background', label: { ar: 'حساسية الخلفية', en: 'Background tolerance' }, min: 5, max: 120, step: 1, unit: '' },
  { kind: 'toggle', key: 'trim', group: 'crop', label: { ar: 'قصّ على المنتج', en: 'Trim to the product' }, icon: Crop, hint: { ar: 'يزيل الهامش الشفاف — عرض الصورة هو عرض المنتج في التجربة.', en: 'Takes the clear margin off — the picture’s width is the product’s width in the try-on.' } },
  { kind: 'slider', key: 'cropTop', group: 'crop', label: { ar: 'من الأعلى', en: 'From the top' }, min: 0, max: 45, step: 1, unit: '%' },
  { kind: 'slider', key: 'cropBottom', group: 'crop', label: { ar: 'من الأسفل', en: 'From the bottom' }, min: 0, max: 45, step: 1, unit: '%' },
  { kind: 'slider', key: 'cropRight', group: 'crop', label: { ar: 'من اليمين', en: 'From the right' }, min: 0, max: 45, step: 1, unit: '%' },
  { kind: 'slider', key: 'cropLeft', group: 'crop', label: { ar: 'من اليسار', en: 'From the left' }, min: 0, max: 45, step: 1, unit: '%' },
  { kind: 'action', id: 'left', group: 'turn', label: { ar: 'تدوير 90° يسارًا', en: 'Rotate 90° left' }, icon: RotateCcw, apply: (e) => ({ rotate: snap(e.rotate - 90) }) },
  { kind: 'action', id: 'right', group: 'turn', label: { ar: 'تدوير 90° يمينًا', en: 'Rotate 90° right' }, icon: RotateCw, apply: (e) => ({ rotate: snap(e.rotate + 90) }) },
  { kind: 'slider', key: 'rotate', group: 'turn', label: { ar: 'الزاوية', en: 'Angle' }, min: -180, max: 180, step: 0.5, unit: '°' },
  { kind: 'toggle', key: 'flipX', group: 'turn', label: { ar: 'قلب أفقي', en: 'Flip horizontal' }, icon: FlipHorizontal2 },
  { kind: 'toggle', key: 'flipY', group: 'turn', label: { ar: 'قلب رأسي', en: 'Flip vertical' }, icon: FlipVertical2 },
  { kind: 'slider', key: 'brightness', group: 'light', label: { ar: 'السطوع', en: 'Brightness' }, min: -100, max: 100, step: 1, unit: '' },
  { kind: 'slider', key: 'contrast', group: 'light', label: { ar: 'التباين', en: 'Contrast' }, min: -100, max: 100, step: 1, unit: '' },
  { kind: 'slider', key: 'saturation', group: 'light', label: { ar: 'التشبّع', en: 'Saturation' }, min: -100, max: 100, step: 1, unit: '' },
  { kind: 'slider', key: 'scale', group: 'size', label: { ar: 'المقياس', en: 'Scale' }, min: 10, max: 400, step: 5, unit: '%' },
  { kind: 'slider', key: 'padding', group: 'size', label: { ar: 'هامش شفاف', en: 'Clear margin' }, min: 0, max: 50, step: 1, unit: '%' },
];

/** An angle folded into −180…180, so the slider shows where a quarter-turn button left it. */
function snap(degrees: number): number {
  const d = ((degrees % 360) + 360) % 360;
  return d > 180 ? d - 360 : d;
}

/** A picture, decoded and brought within `maxSide`, as plain pixels. */
export async function decodeToRgba(blob: Blob, maxSide = WORK_PX): Promise<Rgba> {
  const bitmap = await createImageBitmap(blob);
  const k = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(bitmap.width * k)); canvas.height = Math.max(1, Math.round(bitmap.height * k));
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close?.();
  return { data: g.getImageData(0, 0, canvas.width, canvas.height).data, width: canvas.width, height: canvas.height };
}

/** Plain pixels as a PNG (transparency kept). */
export async function rgbaToPng(img: Rgba): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = img.width; canvas.height = img.height;
  canvas.getContext('2d')!.putImageData(new ImageData(img.data as Uint8ClampedArray<ArrayBuffer>, img.width, img.height), 0, 0);
  return new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('the picture could not be made'))), 'image/png'));
}

type History = { past: Edits[]; now: Edits; future: Edits[]; lastKey: string | null; lastAt: number };

export function ImageEditor({ open, title, sources, initialSource, fileName, onSave, onClose }: {
  open: boolean; title: string; sources: EditorSource[]; initialSource?: string; fileName: string;
  /** Hands the finished PNG to the caller (the try-on's upload); throws to say why it was refused. */
  onSave: (file: File) => Promise<void>;
  onClose: () => void;
}) {
  const { t, pick } = useLang();
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const localPicker = useRef<HTMLInputElement>(null);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [base, setBase] = useState<Rgba | null>(null);
  const [loading, setLoading] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [group, setGroup] = useState<Group>('background');
  const [hist, setHist] = useState<History>({ past: [], now: NO_EDITS, future: [], lastKey: null, lastAt: 0 });
  const [preview, setPreview] = useState<EditResult | null>(null);
  /** When the background will not come off, the picture with it kept — so the merchant still sees what they edit. */
  const [asIs, setAsIs] = useState<Rgba | null>(null);
  const [busy, setBusy] = useState<'save' | 'download' | null>(null);
  const [erasing, setErasing] = useState(false);
  const edits = hist.now;

  // open and close the native dialog with the prop; Escape closes through onClose
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  const load = useCallback(async (blob: Blob, store: boolean, id: string) => {
    setLoading(true); setProblem(null); setSourceId(id);
    try {
      const img = await decodeToRgba(blob);
      setBase(img);
      // a store photo starts the way the one-click path always made it: background off, cropped to the product
      const start: Edits = store ? { ...NO_EDITS, removeBackground: true, trim: true } : NO_EDITS;
      setHist({ past: [], now: start, future: [], lastKey: null, lastAt: 0 });
      setErasing(false);
    } catch {
      setProblem(t('تعذّر فتح هذه الصورة.', 'This picture could not be opened.'));
    } finally { setLoading(false); }
  }, [t]);

  // the first source, once: the caller mounts the editor for each opening, so it always starts fresh
  useEffect(() => {
    const first = sources.find((s) => s.id === initialSource) ?? sources[0];
    if (first) void first.load().then((b) => load(b, !!first.store, first.id), () => setProblem(t('تعذّر جلب الصورة.', 'The picture could not be fetched.')));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, on mount; the sources list is rebuilt each render
  }, []);

  const small = useMemo(() => (base ? resize(base, Math.min(1, PREVIEW_PX / Math.max(base.width, base.height))) : null), [base]);

  // redraw the preview on the next frame after a change (sliders stay smooth)
  useEffect(() => {
    if (!small) return;
    const id = requestAnimationFrame(() => {
      // the clear margin and scale are relative, so the small copy shows them as the full picture will have them
      const result = applyEdits(small, edits, erasing ? ERASE_ONLY : EDIT_STEPS);
      setPreview(result);
      const kept = !result.ok && result.reason === 'not_plain' ? applyEdits(small, { ...edits, removeBackground: false }) : null;
      setAsIs(kept?.ok ? kept.image : null);
    });
    return () => cancelAnimationFrame(id);
  }, [small, edits, erasing]);

  const drawn = preview?.ok ? preview.image : asIs;
  useEffect(() => {
    const c = canvas.current;
    if (!c || !drawn) return;
    c.width = drawn.width; c.height = drawn.height;
    c.getContext('2d')!.putImageData(new ImageData(drawn.data as Uint8ClampedArray<ArrayBuffer>, drawn.width, drawn.height), 0, 0);
  }, [drawn]);

  /** A change; slider drags on one control fold into one undo step. */
  const change = useCallback((patch: Partial<Edits>, key: string) => {
    setHist((h) => {
      const now = { ...h.now, ...patch };
      const at = Date.now();
      const fold = h.lastKey === key && at - h.lastAt < 700;
      return { past: fold ? h.past : [...h.past, h.now].slice(-50), now, future: [], lastKey: key, lastAt: at };
    });
  }, []);
  const undo = useCallback(() => setHist((h) => (h.past.length ? { past: h.past.slice(0, -1), now: h.past[h.past.length - 1]!, future: [h.now, ...h.future], lastKey: null, lastAt: 0 } : h)), []);
  const redo = useCallback(() => setHist((h) => (h.future.length ? { past: [...h.past, h.now], now: h.future[0]!, future: h.future.slice(1), lastKey: null, lastAt: 0 } : h)), []);
  const reset = () => change(NO_EDITS, 'reset');

  /** A click on the preview while erasing: the spot, as shares of the picture (the canvas is drawn without distortion). */
  const eraseHere = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!erasing) return;
    const r = e.currentTarget.getBoundingClientRect();
    const spot = { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    if (spot.x < 0 || spot.x > 1 || spot.y < 0 || spot.y > 1 || edits.erase.length >= MAX_SPOTS) return;
    change({ erase: [...edits.erase, spot] }, `erase-${edits.erase.length}`); // each click is its own undo step
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    if (e.key.toLowerCase() === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
    else if (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey)) { e.preventDefault(); redo(); }
  };

  /** The full-size result as a PNG, or the reason it cannot be made (always every step — erasing only changes the preview). */
  const finished = async (): Promise<File | string> => {
    if (!base) return t('لا توجد صورة.', 'There is no picture.');
    const full = applyEdits(base, edits);
    if (!full.ok) return pick(EDIT_REASONS[full.reason]);
    return new File([await rgbaToPng(full.image)], fileName, { type: 'image/png' });
  };
  const save = async () => {
    setBusy('save'); setProblem(null);
    try {
      const file = await finished();
      if (typeof file === 'string') { setProblem(file); return; }
      await onSave(file);
      onClose();
    } catch (e) { setProblem((e as Error).message); } finally { setBusy(null); }
  };
  const download = async () => {
    setBusy('download'); setProblem(null);
    try {
      const file = await finished();
      if (typeof file === 'string') { setProblem(file); return; }
      const url = URL.createObjectURL(file);
      const a = document.createElement('a');
      a.href = url; a.download = fileName; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch (e) { setProblem((e as Error).message); } finally { setBusy(null); }
  };

  const failed = preview && !preview.ok ? pick(EDIT_REASONS[preview.reason]) : null;
  const shown = EDITOR_TOOLS.filter((tool) => tool.group === group);

  return (
    <dialog ref={dialog} className="img-editor" aria-labelledby="img-editor-title" onClose={onClose} onCancel={(e) => { e.preventDefault(); onClose(); }} onKeyDown={onKey}>
      <header className="img-editor-head">
        <h2 id="img-editor-title">{title}</h2>
        <div className="img-editor-history">
          <button type="button" className="icon-btn" onClick={undo} disabled={!hist.past.length} aria-label={t('تراجع', 'Undo')} title={t('تراجع (Ctrl+Z)', 'Undo (Ctrl+Z)')}><Undo2 size={16} /></button>
          <button type="button" className="icon-btn" onClick={redo} disabled={!hist.future.length} aria-label={t('إعادة', 'Redo')} title={t('إعادة (Ctrl+Y)', 'Redo (Ctrl+Y)')}><Redo2 size={16} /></button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={reset} disabled={!isEdited(edits)}>{t('ابدأ من جديد', 'Reset')}</button>
          <button type="button" className="icon-btn" onClick={onClose} aria-label={t('إغلاق', 'Close')}><X size={18} /></button>
        </div>
      </header>

      <div className="img-editor-body">
        <section className="img-editor-stage" aria-label={t('المعاينة', 'Preview')}>
          <div className="img-editor-canvas tryon-checker">
            {loading ? <span className="hint" role="status">{t('جارٍ فتح الصورة…', 'Opening the picture…')}</span>
              : failed && !asIs ? <p className="field-error" role="alert" style={{ padding: 16 }}>{failed}</p>
                : <canvas ref={canvas} className={erasing ? 'is-picking' : undefined} onClick={eraseHere}
                  aria-label={erasing ? t('الصورة كما هي — انقر على ما تريد إزالته', 'The picture as it is — click what you want gone') : t('الصورة بعد التعديل', 'The edited picture')} />}
          </div>
          {erasing && (
            <div className="img-editor-refusal" role="status">
              <span className="hint" style={{ margin: 0 }}>{t(`انقر على ما تريد إزالته — النقرات: ${edits.erase.length}. تُعرض الصورة كما هي حتى تنتهي.`, `Click what you want gone — clicks: ${edits.erase.length}. The picture shows as it is until you finish.`)}</span>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => setErasing(false)}>{t('انتهيت', 'Done')}</button>
            </div>
          )}
          {failed && asIs && (
            <div className="img-editor-refusal" role="alert">
              <p className="field-error" style={{ margin: 0 }}>{failed}</p>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => change({ removeBackground: false }, 'keep-background')}>{t('أبقِ الخلفية', 'Keep the background')}</button>
            </div>
          )}
          {preview?.ok && base && <span className="hint" dir="ltr" style={{ margin: 0 }}>{fullSize(base, preview.image, small)}</span>}

          <div className="img-editor-sources">
            <span className="hint" style={{ margin: 0 }}>{t('ابدأ من:', 'Start from:')}</span>
            <div className="img-editor-thumbs">
              {sources.map((s) => (
                <button key={s.id} type="button" className="img-editor-thumb" aria-pressed={sourceId === s.id} disabled={loading}
                  onClick={() => void s.load().then((b) => load(b, !!s.store, s.id), () => setProblem(t('تعذّر جلب الصورة.', 'The picture could not be fetched.')))}
                  title={pick(s.label)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- the store's own picture, or a blob: of the merchant's */}
                  {s.thumb ? <img src={s.thumb} alt="" loading="lazy" referrerPolicy="no-referrer" /> : <span>{pick(s.label)}</span>}
                </button>
              ))}
              <button type="button" className="img-editor-thumb" aria-pressed={sourceId === 'local'} disabled={loading} onClick={() => localPicker.current?.click()} title={t('صورة من جهازك', 'A picture from your computer')}>
                <ImageUp size={18} aria-hidden /><span>{t('من جهازك', 'From your computer')}</span>
              </button>
              <input ref={localPicker} type="file" accept="image/png,image/webp,image/jpeg,.png,.webp,.jpg,.jpeg" hidden
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void load(f, false, 'local'); e.target.value = ''; }} />
            </div>
          </div>
        </section>

        <section className="img-editor-tools" aria-label={t('أدوات التعديل', 'Editing tools')}>
          <div role="tablist" className="img-editor-tabs" aria-label={t('مجموعات الأدوات', 'Tool groups')}>
            {GROUPS.map((g) => (
              <button key={g.id} type="button" role="tab" aria-selected={group === g.id} className={`btn btn-sm ${group === g.id ? 'btn-accent' : 'btn-ghost'}`} onClick={() => { setGroup(g.id); setErasing(false); }}>
                <g.icon size={15} aria-hidden />{pick(g.label)}
              </button>
            ))}
          </div>
          <div className="img-editor-controls" role="tabpanel">
            {shown.map((tool) => {
              if (tool.kind === 'toggle') {
                const on = edits[tool.key];
                return (
                  <div key={tool.key} className={`img-editor-control${tool.hint ? '' : ' is-compact'}`}>
                    <button type="button" className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={on} disabled={!base}
                      onClick={() => change({ [tool.key]: !on } as Partial<Edits>, tool.key)}><tool.icon size={15} aria-hidden />{pick(tool.label)}</button>
                    {tool.hint && <span className="hint" style={{ margin: 0 }}>{pick(tool.hint)}</span>}
                  </div>
                );
              }
              if (tool.kind === 'erase') {
                return (
                  <div key="erase" className="img-editor-control">
                    <div className="img-editor-slider-row">
                      <button type="button" className={`btn btn-sm ${erasing ? 'btn-primary' : 'btn-ghost'}`} aria-pressed={erasing} disabled={!base} onClick={() => setErasing((v) => !v)}>
                        <tool.icon size={15} aria-hidden />{pick(tool.label)}
                      </button>
                      {edits.erase.length > 0 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => change({ erase: [] }, 'erase-clear')}>{t(`ألغِ النقرات (${edits.erase.length})`, `Clear the clicks (${edits.erase.length})`)}</button>}
                    </div>
                    <span className="hint" style={{ margin: 0 }}>{pick(tool.hint)}</span>
                  </div>
                );
              }
              if (tool.kind === 'action') {
                return (
                  <div key={tool.id} className="img-editor-control is-compact">
                    <button type="button" className="btn btn-ghost btn-sm" disabled={!base} onClick={() => change(tool.apply(edits), tool.id)}><tool.icon size={15} aria-hidden />{pick(tool.label)}</button>
                  </div>
                );
              }
              const value = edits[tool.key];
              const id = `img-ed-${tool.key}`;
              const neutral = NO_EDITS[tool.key];
              // the background's tolerance means nothing while the background stays on
              const off = !base || (tool.key === 'tolerance' && !edits.removeBackground && !erasing && !edits.erase.length);
              return (
                <div key={tool.key} className="img-editor-control img-editor-slider">
                  <label htmlFor={id}>{pick(tool.label)} <span dir="ltr" className="mm">{value}{tool.unit}</span></label>
                  <div className="img-editor-slider-row">
                    <input id={id} type="range" min={tool.min} max={tool.max} step={tool.step} value={value} disabled={off}
                      onChange={(e) => change({ [tool.key]: Number(e.target.value) } as Partial<Edits>, tool.key)} />
                    <input type="number" className="img-editor-number" dir="ltr" min={tool.min} max={tool.max} step={tool.step} value={value} disabled={off}
                      aria-label={pick(tool.label)} onChange={(e) => { const v = Number(e.target.value); if (Number.isFinite(v)) change({ [tool.key]: Math.min(tool.max, Math.max(tool.min, v)) } as Partial<Edits>, tool.key); }} />
                    {value !== neutral && <button type="button" className="btn btn-ghost btn-sm" onClick={() => change({ [tool.key]: neutral } as Partial<Edits>, `${tool.key}-reset`)} aria-label={t(`أعد ${pick(tool.label)}`, `Reset ${pick(tool.label)}`)}>↺</button>}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {problem && <p className="field-error" role="alert" style={{ margin: '0 20px 12px' }}>{problem}</p>}
      <footer className="img-editor-foot">
        <span className="hint" style={{ margin: 0 }}>{t('تُحفظ الصورة بخلفية شفافة (PNG) وتُفحص كأي صورة مرفوعة.', 'The picture is saved with a transparent background (PNG) and checked like any upload.')}</span>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void download()} disabled={!base || busy !== null || !!failed}>
            <Download size={15} aria-hidden />{busy === 'download' ? t('جارٍ التجهيز…', 'Preparing…') : t('حمّلها إلى جهازك', 'Download')}
          </button>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={!base || busy !== null || !!failed}>
            <Save size={15} aria-hidden />{busy === 'save' ? t('جارٍ الحفظ والفحص…', 'Saving and checking…') : t('احفظ للتجربة', 'Save to the try-on')}
          </button>
        </div>
      </footer>
    </dialog>
  );
}

/** The saved picture's size, read from the preview (which works on a smaller copy). */
function fullSize(base: Rgba, shown: Rgba, small: Rgba | null): string {
  const k = small ? base.width / small.width : 1;
  return `${Math.round(shown.width * k)} × ${Math.round(shown.height * k)} px`;
}
