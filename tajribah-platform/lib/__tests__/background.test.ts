/**
 * T88 — a plain background taken off in the browser: real cut-outs (the demo's bag and ring) laid on
 * white come back as themselves — the shape kept, the white gone, the ring's middle clear — and a picture
 * with a scene behind it is refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import sharp from 'sharp';
import { removeBackground, type Rgba } from '@/lib/background';

async function onWhite(file: string): Promise<{ flat: Rgba; alpha: Rgba }> {
  const path = join(process.cwd(), 'public', 'assets', file);
  const pad = { top: 40, bottom: 40, left: 40, right: 40, background: { r: 255, g: 255, b: 255, alpha: 0 } };
  const alpha = await sharp(path).extend(pad).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const flat = await sharp(path).extend(pad).flatten({ background: '#ffffff' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const rgba = (r: typeof alpha) => ({ data: new Uint8ClampedArray(r.data), width: r.info.width, height: r.info.height });
  return { flat: rgba(flat), alpha: rgba(alpha) };
}

/** How well the product's shape came back: shared opaque pixels over all opaque pixels (1 = the same). */
function overlap(original: Rgba, result: Rgba, dx: number, dy: number): number {
  let both = 0, either = 0;
  for (let y = 0; y < original.height; y++) for (let x = 0; x < original.width; x++) {
    const a = original.data[(y * original.width + x) * 4 + 3]! > 128;
    const rx = x - dx, ry = y - dy;
    const inside = rx >= 0 && ry >= 0 && rx < result.width && ry < result.height;
    const b = inside && result.data[(ry * result.width + rx) * 4 + 3]! > 128;
    if (a && b) both++;
    if (a || b) either++;
  }
  return both / either;
}

function firstOpaque(img: Rgba): { x: number; y: number } {
  let x0 = img.width, y0 = img.height;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) if (img.data[(y * img.width + x) * 4 + 3]! > 0) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); }
  return { x: x0, y: y0 };
}

for (const file of ['bag-front.webp', 'ring-top.webp']) {
  test(`${file} laid on white: the white goes, the product stays, cropped to it`, async () => {
    const { flat, alpha } = await onWhite(file);
    const result = removeBackground(flat);
    assert.ok(result.ok, 'a plain white background');
    const at = firstOpaque(alpha);
    const score = overlap(alpha, result.image, at.x, at.y);
    assert.ok(score > 0.95, `the shape came back: ${score.toFixed(3)}`);
    assert.ok(result.image.width < flat.width - 60 && result.image.height < flat.height - 60, 'cropped to the product');
    const corner = result.image.data[3]!;
    assert.ok(corner < 128 || alpha.data[(at.y * alpha.width + at.x) * 4 + 3]! > 0, 'its corner is clear unless the product reaches it');
  });
}

test('a hole the product encloses goes clear; a small highlight inside it stays', () => {
  const w = 200, h = 200;
  const data = new Uint8ClampedArray(w * h * 4).fill(255);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const r = Math.hypot(x - 100, y - 100);
    const i = (y * w + x) * 4;
    if (r >= 40 && r <= 70) { data[i] = 150; data[i + 1] = 150; data[i + 2] = 160; } // a silver band
    if (Math.hypot(x - 100, y - 45) <= 2) { data[i] = 255; data[i + 1] = 255; data[i + 2] = 255; } // a highlight on it
  }
  const result = removeBackground({ data, width: w, height: h });
  assert.ok(result.ok);
  const { image } = result;
  const alphaAt = (x: number, y: number) => image.data[(y * image.width + x) * 4 + 3]!;
  const ox = Math.round((image.width - 141) / 2); // the band is 141 px across
  assert.equal(alphaAt(70 + ox, 70 + ox), 0, 'the middle of the ring is clear');
  assert.equal(alphaAt(70 + ox, 15 + ox), 255, 'the highlight on the band stays');
  assert.equal(alphaAt(70 + ox, 0 + ox + 1), 255, 'the band stays');
});

test('a picture with a scene behind it is refused; a blank one leaves nothing', () => {
  const w = 120, h = 80;
  const scene = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { scene[i * 4] = (i * 37) % 256; scene[i * 4 + 1] = (i * 91) % 256; scene[i * 4 + 2] = (i * 13) % 256; scene[i * 4 + 3] = 255; }
  assert.deepEqual(removeBackground({ data: scene, width: w, height: h }), { ok: false, reason: 'not_plain' });
  assert.deepEqual(removeBackground({ data: new Uint8ClampedArray(w * h * 4).fill(255), width: w, height: h }), { ok: false, reason: 'nothing_left' });
});
