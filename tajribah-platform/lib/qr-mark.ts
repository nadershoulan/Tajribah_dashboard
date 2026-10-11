/**
 * T134.2 — every QR code carries a small mark in its corner: Tajribah's, or the store's own logo when it has its own
 * brand (Nader, 2026-10-11).
 *
 * A QR code can lose part of itself and still read: at error correction **H**, about 30 % of its data. The mark sits in
 * the **bottom-right corner** — the only corner without a finder square — inside the corner modules, clear of the
 * alignment square that guides a camera at an angle, and runs a little into the margin. It covers far less than H can
 * recover, so the code still scans; the tests prove it by reading every marked code back with a QR reader.
 *
 * `markedQr` is the layout (pure); `markedQrSvg` writes it as SVG for the screen and for download; `drawMarkedQr` paints
 * it on a canvas (the PNG download, the studio's pairing code).
 */
import QRCode from 'qrcode';

export type MarkedQr = {
  /** Modules across the code itself. */
  count: number;
  /** Modules of quiet margin on each side. */
  margin: number;
  /** Dark modules, row by row (`dark[y][x]`), the code only (no margin). */
  dark: boolean[][];
  /** The mark's square, in modules from the top-left of the whole picture (margin included). */
  badge: { x: number; y: number; size: number };
};

/** Modules of the corner the mark may take inside the code: from the edge to just before the alignment square. */
function cornerRoom(version: number): number {
  // Version 1 has no alignment square; from version 2 its 5×5 block ends 5 modules from the bottom-right edge.
  return version < 2 ? 6 : 4;
}

/** The code for `text` at error correction H, and where the mark goes. */
export function markedQr(text: string, { margin = 3 }: { margin?: number } = {}): MarkedQr {
  const qr = QRCode.create(text, { errorCorrectionLevel: 'H' });
  const count = qr.modules.size;
  const dark = Array.from({ length: count }, (_, y) => Array.from({ length: count }, (_, x) => !!qr.modules.get(y, x)));
  const room = cornerRoom(qr.version);
  // into the corner modules, and on into the margin — all but one module of it, so a quiet edge remains
  const into = Math.max(0, margin - 1);
  const size = room + into;
  return { count, margin, dark, badge: { x: margin + count - room, y: margin + count - room, size } };
}

/** Whether module (x, y) of the code (no margin) is under the mark — it is left out, the mark drawn there instead. */
export function underBadge(qr: MarkedQr, x: number, y: number): boolean {
  const bx = qr.badge.x - qr.margin, by = qr.badge.y - qr.margin;
  return x >= bx && y >= by && x < bx + qr.badge.size && y < by + qr.badge.size;
}

export type MarkStyle = { dark?: string; light?: string; /** An image for the mark (a URL or data: URL); none — a plain light badge. */ mark?: string | null };

/** The marked code as SVG, `px` wide. */
export function markedQrSvg(text: string, px: number, style: MarkStyle = {}): string {
  const qr = markedQr(text);
  const dark = style.dark ?? '#0A2237', light = style.light ?? '#ffffff';
  const total = qr.count + qr.margin * 2;
  let path = '';
  for (let y = 0; y < qr.count; y++) for (let x = 0; x < qr.count; x++) {
    if (qr.dark[y]![x] && !underBadge(qr, x, y)) path += `M${x + qr.margin} ${y + qr.margin}h1v1h-1z`;
  }
  const b = qr.badge, pad = b.size * MARK_PAD;
  const mark = style.mark
    ? `<image href="${style.mark.replace(/"/g, '&quot;')}" x="${b.x + pad}" y="${b.y + pad}" width="${b.size - pad * 2}" height="${b.size - pad * 2}" preserveAspectRatio="xMidYMid meet"/>`
    : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${px}" height="${px}" shape-rendering="crispEdges">`
    + `<rect width="${total}" height="${total}" fill="${light}"/><path d="${path}" fill="${dark}"/>`
    + `<rect x="${b.x}" y="${b.y}" width="${b.size}" height="${b.size}" rx="${b.size * 0.22}" fill="${light}" stroke="${dark}" stroke-opacity="0.12" stroke-width="0.12"/>`
    + mark + '</svg>';
}

/** Paint the marked code on a canvas `px` wide (a loaded mark image, or none). */
export function drawMarkedQr(ctx: CanvasRenderingContext2D, text: string, px: number, style: { dark?: string; light?: string; mark?: CanvasImageSource | null } = {}): void {
  const qr = markedQr(text);
  const total = qr.count + qr.margin * 2, m = px / total;
  ctx.fillStyle = style.light ?? '#ffffff';
  ctx.fillRect(0, 0, px, px);
  ctx.fillStyle = style.dark ?? '#0A2237';
  for (let y = 0; y < qr.count; y++) for (let x = 0; x < qr.count; x++) {
    if (qr.dark[y]![x] && !underBadge(qr, x, y)) ctx.fillRect(Math.round((x + qr.margin) * m), Math.round((y + qr.margin) * m), Math.ceil(m), Math.ceil(m));
  }
  const b = qr.badge, bx = b.x * m, by = b.y * m, bs = b.size * m, r = bs * 0.22;
  ctx.fillStyle = style.light ?? '#ffffff';
  ctx.beginPath();
  ctx.roundRect(bx, by, bs, bs, r);
  ctx.fill();
  if (style.mark) {
    // never stretched: the mark keeps its own proportions, centred in the badge (Nader, 2026-10-11 — a wide picture
    // squeezed into the square looked pulled tall)
    const pad = bs * MARK_PAD, room = bs - pad * 2;
    const { width: w, height: h } = sizeOf(style.mark);
    const k = w > 0 && h > 0 ? Math.min(room / w, room / h) : 0;
    if (k) ctx.drawImage(style.mark, bx + (bs - w * k) / 2, by + (bs - h * k) / 2, w * k, h * k);
  }
}

/** The mark's share of the badge left empty on each side (a smaller mark, clear of the code's modules). */
export const MARK_PAD = 0.2;
/** The mark made for QR codes: the Tajribah mark trimmed to its own edges, on a square (`public/brand/`). */
export const QR_MARK = '/brand/tajribah-mark-qr.png';

/** A drawable's own size: an image's natural size, a canvas's or bitmap's width and height. */
function sizeOf(source: CanvasImageSource): { width: number; height: number } {
  const s = source as { naturalWidth?: number; naturalHeight?: number; width?: number | { baseVal?: { value: number } }; height?: number | { baseVal?: { value: number } } };
  if (s.naturalWidth && s.naturalHeight) return { width: s.naturalWidth, height: s.naturalHeight };
  const num = (v: unknown) => (typeof v === 'number' ? v : (v as { baseVal?: { value: number } } | undefined)?.baseVal?.value ?? 0);
  return { width: num(s.width), height: num(s.height) };
}

/** A marked code as a PNG data URL (browser): the mark loaded from `markUrl` first; without it, a plain badge. */
export async function markedQrPng(text: string, px: number, markUrl: string | null, colours: { dark?: string; light?: string } = {}): Promise<string> {
  const canvas = document.createElement('canvas');
  canvas.width = px; canvas.height = px;
  const ctx = canvas.getContext('2d')!;
  let mark: HTMLImageElement | null = null;
  if (markUrl) {
    mark = await new Promise<HTMLImageElement | null>((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = markUrl;
    });
  }
  drawMarkedQr(ctx, text, px, { ...colours, mark });
  return canvas.toDataURL('image/png');
}
