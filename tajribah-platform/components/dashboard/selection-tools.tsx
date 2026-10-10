'use client';

/**
 * T131 — the picture editor's selection tools, as Photoshop has them: Selection Brush, Lasso, Polygonal Lasso,
 * Magnetic Lasso. The layer sits exactly over the preview, follows the pointer, draws the shape being made and the
 * selection's marching ants; the panel holds the tool, the mode (New, Add, Subtract, Intersect), each tool's options
 * and what to do with the selection.
 *
 * Shapes are worked out in the preview's pixels and handed back as shares of the picture (`lib/selection.ts`), so the
 * editor can use them on the full picture.
 *
 * Keys, as in Photoshop: Shift (add), Alt (subtract), Shift+Alt (intersect) held when a shape starts; Backspace
 * removes the last point of a polygonal or magnetic lasso, Esc cancels it, Enter or a double click closes it; the
 * editor adds Delete, Ctrl+D, Ctrl+A, Ctrl+Shift+I, and L / Shift+L to change lasso, A for the brush.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Brush, Lasso, LassoSelect, Magnet, type LucideIcon } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import type { Bi } from '@/lib/lang';
import {
  edgeMap, liveWire, maskOutline, rasterize, simplify, snapToEdge,
  type Pt, type Rgba, type SelMode, type SelShape, type Selection,
} from '@/lib/selection';

export type SelTool = 'brush' | 'lasso' | 'polygon' | 'magnetic';
export type SelOptions = {
  /** Brush radius, preview pixels. */
  brush: number;
  /** Magnetic lasso: how far from the pointer an edge is looked for (preview pixels). */
  width: number;
  /** Magnetic lasso: edges weaker than this (0…100 %) count as none. */
  contrast: number;
  /** Magnetic lasso: how often an anchor is dropped (0…100; higher, more often). */
  frequency: number;
  /** Feather on Delete / Keep only, in the full picture's pixels. */
  feather: number;
};
export const DEFAULT_SEL_OPTIONS: SelOptions = { brush: 18, width: 10, contrast: 10, frequency: 57, feather: 1 };

export const SEL_TOOLS: { id: SelTool; icon: LucideIcon; label: Bi; key: string; hint: Bi }[] = [
  { id: 'brush', icon: Brush, key: 'A', label: { ar: 'فرشاة التحديد', en: 'Selection Brush' }, hint: { ar: 'ارسم فوق ما تريد تحديده. Alt: أزل من التحديد.', en: 'Paint over what you want selected. Alt: take away from it.' } },
  { id: 'lasso', icon: Lasso, key: 'L', label: { ar: 'اللاسو', en: 'Lasso' }, hint: { ar: 'اسحب حول الجزء بحرية؛ يُغلق الشكل حين تفلت.', en: 'Drag freely around the part; the shape closes when you let go.' } },
  { id: 'polygon', icon: LassoSelect, key: 'L', label: { ar: 'اللاسو المضلّع', en: 'Polygonal Lasso' }, hint: { ar: 'انقر نقطة بعد نقطة؛ أغلق بالنقر على أول نقطة أو بنقرة مزدوجة أو Enter. Backspace يحذف آخر نقطة، Esc يلغي.', en: 'Click point after point; close by clicking the first point, a double click or Enter. Backspace removes the last point, Esc cancels.' } },
  { id: 'magnetic', icon: Magnet, key: 'L', label: { ar: 'اللاسو المغناطيسي', en: 'Magnetic Lasso' }, hint: { ar: 'انقر عند حافة المنتج ثم حرّك المؤشر بمحاذاتها: يلتصق الخط بالحافة وتُضاف النقاط تلقائيًا. انقر لإضافة نقطة، نقرة مزدوجة أو Enter للإغلاق، Backspace لحذف آخر نقطة.', en: 'Click on the product’s edge, then move along it: the line sticks to the edge and drops points by itself. Click to add a point, double click or Enter to close, Backspace to remove the last point.' } },
];

export const SEL_MODES: { id: SelMode; label: Bi; keys: string }[] = [
  { id: 'new', label: { ar: 'جديد', en: 'New' }, keys: '' },
  { id: 'add', label: { ar: 'إضافة', en: 'Add' }, keys: 'Shift' },
  { id: 'subtract', label: { ar: 'طرح', en: 'Subtract' }, keys: 'Alt' },
  { id: 'intersect', label: { ar: 'تقاطع', en: 'Intersect' }, keys: 'Shift+Alt' },
];

/** The mode a shape starts in: the keys held win over the panel's choice (Photoshop). The brush adds unless told. */
function modeFor(e: { shiftKey: boolean; altKey: boolean }, chosen: SelMode, tool: SelTool, hasSelection: boolean): SelMode {
  if (e.shiftKey && e.altKey) return 'intersect';
  if (e.shiftKey) return 'add';
  if (e.altKey) return 'subtract';
  if (tool === 'brush' && chosen === 'new' && hasSelection) return 'add';
  return chosen;
}

const pathLength = (pts: Pt[]) => pts.reduce((n, p, i) => (i ? n + Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) : 0), 0);

type Drawing =
  | { tool: 'brush' | 'lasso'; mode: SelMode; points: Pt[] }
  | { tool: 'polygon'; mode: SelMode; points: Pt[] }
  | { tool: 'magnetic'; mode: SelMode; points: Pt[]; anchors: number[]; live: Pt[] };

/**
 * The layer over the preview. `frame`: where the picture is drawn inside the preview box (CSS pixels); `image`: the
 * picture as shown (its pixels are the layer's own); `onShape` gets each finished shape, in shares.
 */
export function SelectionLayer({ frame, image, selection, tool, mode, options, onShape, onBusy }: {
  frame: { left: number; top: number; width: number; height: number };
  image: Rgba; selection: Selection; tool: SelTool; mode: SelMode; options: SelOptions;
  onShape: (shape: SelShape, mode: SelMode) => void;
  /** Whether a polygonal or magnetic shape is under way (the editor leaves Backspace and Delete to it then). */
  onBusy: (busy: boolean) => void;
}) {
  const { t } = useLang();
  const { width: w, height: h } = image;
  const surface = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [pointer, setPointer] = useState<Pt | null>(null);
  const [phase, setPhase] = useState(0);
  const edges = useMemo(() => (tool === 'magnetic' ? edgeMap(image) : null), [tool, image]);
  const mask = useMemo(() => rasterize(selection, w, h), [selection, w, h]);
  const outline = useMemo(() => maskOutline(mask, w, h), [mask, w, h]);
  const scale = w / frame.width; // picture pixels per screen pixel

  useEffect(() => { onBusy(!!drawing && (drawing.tool === 'polygon' || drawing.tool === 'magnetic')); }, [drawing, onBusy]);
  // the ants march
  useEffect(() => {
    if (!outline.length) return;
    const id = setInterval(() => setPhase((p) => (p + 1) % 8), 140);
    return () => clearInterval(id);
  }, [outline.length]);

  const toPx = (e: React.PointerEvent | React.MouseEvent): Pt => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: Math.min(w - 1, Math.max(0, ((e.clientX - r.left) / r.width) * w)), y: Math.min(h - 1, Math.max(0, ((e.clientY - r.top) / r.height) * h)) };
  };
  const share = (p: Pt): Pt => ({ x: p.x / w, y: p.y / h });
  const finishPolygon = (points: Pt[], m: SelMode) => {
    setDrawing(null);
    if (points.length >= 3) onShape({ kind: 'polygon', points: simplify(points, 0.6).map(share) }, m);
  };
  const spacing = 10 + (100 - Math.min(100, Math.max(0, options.frequency))) * 0.8; // anchor every N preview px
  const contrast = Math.min(1, Math.max(0.01, options.contrast / 100));
  const magnetPoint = (p: Pt) => (edges ? snapToEdge(edges, w, h, p, options.width, contrast) : p);
  const nearFirst = (d: Drawing, p: Pt) => d.points.length > 2 && Math.hypot(p.x - d.points[0]!.x, p.y - d.points[0]!.y) <= 8 * scale;

  /** The magnetic lasso's wire from its last anchor to `p`, with anchors dropped along it every `spacing`. */
  const advance = (d: Extract<Drawing, { tool: 'magnetic' }>, p: Pt): Extract<Drawing, { tool: 'magnetic' }> => {
    if (!edges) return d;
    let points = d.points, anchors = d.anchors;
    let from = points[points.length - 1]!;
    let live = liveWire(edges, w, h, from, magnetPoint(p), options.width, contrast);
    // too long: fix the first stretch as path, anchor at its end, and look again from there
    for (let guard = 0; guard < 20 && pathLength(live) > spacing * 1.5; guard++) {
      let k = 1, len = 0;
      while (k < live.length - 1 && len < spacing) { len += Math.hypot(live[k]!.x - live[k - 1]!.x, live[k]!.y - live[k - 1]!.y); k++; }
      points = [...points, ...live.slice(1, k + 1)];
      anchors = [...anchors, points.length - 1];
      from = points[points.length - 1]!;
      live = liveWire(edges, w, h, from, magnetPoint(p), options.width, contrast);
    }
    return { ...d, points, anchors, live };
  };

  const down = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const p = toPx(e);
    const m = drawing?.mode ?? modeFor(e, mode, tool, selection.ops.length > 0 || selection.inverted);
    if (tool === 'brush' || tool === 'lasso') {
      e.currentTarget.setPointerCapture(e.pointerId);
      setDrawing({ tool, mode: m, points: [p] });
      return;
    }
    if (tool === 'polygon') {
      if (drawing?.tool === 'polygon') {
        if (nearFirst(drawing, p)) return finishPolygon(drawing.points, drawing.mode);
        setDrawing({ ...drawing, points: [...drawing.points, p] });
      } else setDrawing({ tool: 'polygon', mode: m, points: [p] });
      return;
    }
    // magnetic
    if (drawing?.tool === 'magnetic') {
      if (nearFirst(drawing, p)) return closeMagnetic(drawing);
      const next = advance(drawing, p);
      const points = [...next.points, ...next.live.slice(1)];
      setDrawing({ ...next, points, anchors: [...next.anchors, points.length - 1], live: [] });
    } else {
      const start = magnetPoint(p);
      setDrawing({ tool: 'magnetic', mode: m, points: [start], anchors: [0], live: [] });
    }
  };
  const closeMagnetic = (d: Extract<Drawing, { tool: 'magnetic' }>) => {
    const back = edges ? liveWire(edges, w, h, d.points[d.points.length - 1]!, d.points[0]!, options.width, contrast) : [];
    finishPolygon([...d.points, ...d.live.slice(1), ...back.slice(1)], d.mode);
  };
  const move = (e: React.PointerEvent<HTMLDivElement>) => {
    const p = toPx(e);
    setPointer(p);
    if (!drawing) return;
    if ((drawing.tool === 'brush' || drawing.tool === 'lasso') && e.buttons & 1) {
      const last = drawing.points[drawing.points.length - 1]!;
      if (Math.hypot(p.x - last.x, p.y - last.y) >= 1) setDrawing({ ...drawing, points: [...drawing.points, p] });
    } else if (drawing.tool === 'magnetic') setDrawing(advance(drawing, p));
  };
  const up = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!drawing || (drawing.tool !== 'brush' && drawing.tool !== 'lasso')) return;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (drawing.tool === 'lasso') return finishPolygon(drawing.points, drawing.mode);
    setDrawing(null);
    onShape({ kind: 'brush', points: simplify(drawing.points, 0.5).map(share), radius: options.brush / Math.max(w, h) }, drawing.mode);
  };
  const dbl = () => {
    if (drawing?.tool === 'polygon') finishPolygon(drawing.points, drawing.mode);
    else if (drawing?.tool === 'magnetic') closeMagnetic(drawing);
  };

  // Backspace / Esc / Enter while a polygonal or magnetic shape is under way — taken before the editor sees them
  useEffect(() => {
    if (!drawing || (drawing.tool !== 'polygon' && drawing.tool !== 'magnetic')) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setDrawing(null); }
      else if (e.key === 'Enter') { if (drawing.tool === 'polygon') finishPolygon(drawing.points, drawing.mode); else closeMagnetic(drawing); }
      else if (e.key === 'Backspace' || e.key === 'Delete') {
        if (drawing.tool === 'polygon') setDrawing(drawing.points.length > 1 ? { ...drawing, points: drawing.points.slice(0, -1) } : null);
        else {
          const anchors = drawing.anchors.slice(0, -1);
          setDrawing(anchors.length ? { ...drawing, anchors, points: drawing.points.slice(0, anchors[anchors.length - 1]! + 1), live: [] } : null);
        }
      } else return;
      e.preventDefault(); e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  });

  // draw: the selection (a faint tint, marching ants) and the shape being made
  useEffect(() => {
    const c = surface.current;
    if (!c) return;
    c.width = w; c.height = h;
    const g = c.getContext('2d')!;
    const px = g.createImageData(w, h);
    for (let i = 0; i < mask.length; i++) if (mask[i]! > 127) { px.data[i * 4] = 0; px.data[i * 4 + 1] = 167; px.data[i * 4 + 2] = 188; px.data[i * 4 + 3] = 46; }
    for (const i of outline) {
      const x = i % w, y = (i - x) / w;
      const on = ((x + y + phase) >> 2) & 1;
      px.data[i * 4] = px.data[i * 4 + 1] = px.data[i * 4 + 2] = on ? 255 : 0;
      px.data[i * 4 + 3] = 255;
    }
    g.putImageData(px, 0, 0);
    const line = (pts: Pt[], close = false, colour = '#fff') => {
      if (pts.length < 2) return;
      g.beginPath(); g.moveTo(pts[0]!.x, pts[0]!.y);
      for (const p of pts.slice(1)) g.lineTo(p.x, p.y);
      if (close) g.closePath();
      g.lineWidth = 2.5 * scale; g.strokeStyle = 'rgba(0,0,0,.7)'; g.stroke();
      g.lineWidth = 1.2 * scale; g.strokeStyle = colour; g.stroke();
    };
    if (drawing?.tool === 'lasso') line(drawing.points);
    if (drawing?.tool === 'brush') {
      g.fillStyle = 'rgba(0,167,188,.45)';
      for (const p of drawing.points) { g.beginPath(); g.arc(p.x, p.y, options.brush, 0, Math.PI * 2); g.fill(); }
    }
    if (drawing?.tool === 'polygon') {
      line(pointer ? [...drawing.points, pointer] : drawing.points);
      for (const p of drawing.points) { g.fillStyle = '#fff'; g.fillRect(p.x - 2 * scale, p.y - 2 * scale, 4 * scale, 4 * scale); }
    }
    if (drawing?.tool === 'magnetic') {
      line([...drawing.points, ...drawing.live.slice(1)], false, '#7ff3ff');
      for (const a of drawing.anchors) { const p = drawing.points[a]!; g.fillStyle = '#fff'; g.fillRect(p.x - 2.5 * scale, p.y - 2.5 * scale, 5 * scale, 5 * scale); }
    }
    if (tool === 'brush' && pointer) { g.beginPath(); g.arc(pointer.x, pointer.y, options.brush, 0, Math.PI * 2); g.lineWidth = 1.2 * scale; g.strokeStyle = '#fff'; g.stroke(); }
  }, [w, h, mask, outline, phase, drawing, pointer, tool, options.brush, scale]);

  const label = SEL_TOOLS.find((x) => x.id === tool)!;
  return (
    <div className={`sel-layer is-${tool}`} style={{ left: frame.left, top: frame.top, width: frame.width, height: frame.height }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setPointer(null)} onDoubleClick={dbl}
      role="application" aria-label={t(`منطقة التحديد — ${label.label.ar}`, `Selection area — ${label.label.en}`)}>
      <canvas ref={surface} aria-hidden />
    </div>
  );
}
