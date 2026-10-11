/**
 * T134.2 — a QR code with a mark in its corner still reads: every marked code is painted as pixels (the mark's badge
 * with a dark logo-like blob in it, the worst case) and read back with a QR reader. A mark grown too big does not read
 * — so the reader is really looking.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import jsQR from 'jsqr';
import { MARK_PAD, QR_MARK, drawMarkedQr, freshMarkUrl, markedQr, markedQrSvg, qrMarkOf, underBadge, type MarkedQr } from '@/lib/qr-mark';

/** The code as RGBA pixels, `px` per module; the badge is light with a dark square in its middle (a logo). */
function paint(qr: MarkedQr, px: number): { data: Uint8ClampedArray; size: number } {
  const total = qr.count + qr.margin * 2, size = total * px;
  const data = new Uint8ClampedArray(size * size * 4).fill(255);
  const dot = (mx: number, my: number) => {
    for (let y = 0; y < px; y++) for (let x = 0; x < px; x++) {
      const i = ((my * px + y) * size + (mx * px + x)) * 4;
      data[i] = data[i + 1] = data[i + 2] = 0;
    }
  };
  for (let y = 0; y < qr.count; y++) for (let x = 0; x < qr.count; x++) if (qr.dark[y]![x] && !underBadge(qr, x, y)) dot(x + qr.margin, y + qr.margin);
  // the logo: a dark square filling the middle half of the badge
  const b = qr.badge, from = b.size * 0.25, to = b.size * 0.75;
  for (let y = Math.ceil(b.y + from); y < b.y + to; y++) for (let x = Math.ceil(b.x + from); x < b.x + to; x++) dot(x, y);
  return { data, size };
}

const read = (qr: MarkedQr, px: number) => { const p = paint(qr, px); return jsQR(p.data, p.size, p.size)?.data ?? null; };

const TEXTS = [
  'https://tajribah.org',
  'https://tajribah.org/capture/0123456789abcdef0123456789abcdef',
  'https://failet.sa/ar/%D8%B3%D8%A7%D8%B9%D8%A7%D8%AA%20%D9%86%D8%B3%D8%A7%D8%A6%D9%8A%D8%A9/p1617831548?utm_source=qr&utm_medium=print',
];

test('every marked code reads back exactly, at several sizes', () => {
  for (const text of TEXTS) {
    const qr = markedQr(text);
    for (const px of [3, 6, 10]) assert.equal(read(qr, px), text, `${text.slice(0, 40)}… at ${px} px a module`);
  }
});

test('the mark sits in the bottom-right corner, clear of the finder squares and the alignment square', () => {
  for (const text of TEXTS) {
    const qr = markedQr(text);
    const total = qr.count + qr.margin * 2;
    assert.ok(qr.badge.x + qr.badge.size <= total && qr.badge.y + qr.badge.size <= total, 'inside the picture');
    assert.ok(qr.badge.x > total / 2 && qr.badge.y > total / 2, 'bottom-right');
    // the three finder squares: 7×7 at top-left, top-right, bottom-left — never under the mark
    for (const [fx, fy] of [[0, 0], [qr.count - 7, 0], [0, qr.count - 7]]) {
      for (let y = fy!; y < fy! + 7; y++) for (let x = fx!; x < fx! + 7; x++) assert.equal(underBadge(qr, x, y), false);
    }
    // the alignment square's 5×5 block ends 5 modules from the bottom-right edge
    assert.equal(underBadge(qr, qr.count - 5, qr.count - 5), false, 'alignment square kept');
    const covered = qr.dark.flat().filter((_, i) => underBadge(qr, i % qr.count, Math.floor(i / qr.count))).length;
    assert.ok(covered / (qr.count * qr.count) < 0.02, 'it covers a tiny share — far less than H recovers');
  }
});

test('the reader is really reading: a mark grown over a large part of the code does not scan', () => {
  const qr = markedQr(TEXTS[1]!);
  const greedy: MarkedQr = { ...qr, badge: { x: qr.margin + 8, y: qr.margin + 8, size: qr.count - 16 } };
  assert.equal(read(greedy, 6), null);
});

test('the SVG: the code, the badge, and the mark image when given', () => {
  const svg = markedQrSvg(TEXTS[0]!, 240, { mark: '/brand/tajribah-mark.png' });
  assert.match(svg, /^<svg[^>]+viewBox="0 0 \d+ \d+"[^>]+width="240"/);
  assert.match(svg, /<image href="\/brand\/tajribah-mark.png"/);
  assert.doesNotMatch(markedQrSvg(TEXTS[0]!, 240), /<image/, 'no mark given: a plain badge');
  assert.match(markedQrSvg(TEXTS[0]!, 240, { mark: 'x" onload="alert(1)' }), /href="x&quot; onload=&quot;alert\(1\)"/, 'the mark URL cannot break out of its attribute');
});

test('the mark is never stretched: a wide picture keeps its proportions, centred, well inside the badge', () => {
  const drawn: number[][] = [];
  const ctx = { fillStyle: '', fillRect() {}, beginPath() {}, roundRect() {}, fill() {}, drawImage: (_: unknown, ...box: number[]) => { drawn.push(box); } } as unknown as CanvasRenderingContext2D;
  const wide = { naturalWidth: 360, naturalHeight: 175 } as unknown as CanvasImageSource; // the original file's shape
  drawMarkedQr(ctx, TEXTS[0]!, 1200, { mark: wide });
  const [x, y, w, h] = drawn[0]!;
  assert.ok(Math.abs(w! / h! - 360 / 175) < 1e-9, `proportions kept: ${w} × ${h}`);
  const qr = markedQr(TEXTS[0]!), m = 1200 / (qr.count + qr.margin * 2), b = qr.badge;
  assert.ok(w! <= b.size * m * (1 - 2 * MARK_PAD) + 1e-9, 'smaller than the badge, with room round it');
  assert.ok(Math.abs(x! + w! / 2 - (b.x + b.size / 2) * m) < 1e-6 && Math.abs(y! + h! / 2 - (b.y + b.size / 2) * m) < 1e-6, 'centred in the badge');
});

test('whose mark: a white-label store’s own logo, or a plain corner — never Tajribah’s on a white-label store; any other store: Tajribah’s', () => {
  assert.equal(qrMarkOf({ logo: 'https://cdn.tajribah.org/t/oud/logo.png' }), 'https://cdn.tajribah.org/t/oud/logo.png');
  assert.equal(qrMarkOf({ logo: null }), null, 'white-label without a logo: plain');
  assert.equal(qrMarkOf(null), QR_MARK);
  assert.equal(qrMarkOf(undefined), QR_MARK);
});

test('a logo the browser kept as a plain copy is asked again at a fresh address; a picture already in the page is not', () => {
  assert.equal(freshMarkUrl('https://cdn.tajribah.org/t/oud/logo.png'), 'https://cdn.tajribah.org/t/oud/logo.png?cors=1');
  assert.equal(freshMarkUrl('https://cdn.salla.sa/logo.png?v=3'), 'https://cdn.salla.sa/logo.png?v=3&cors=1');
  assert.equal(freshMarkUrl('data:image/png;base64,AAAA'), null);
  assert.equal(freshMarkUrl('blob:https://tajribah.org/1'), null);
});

