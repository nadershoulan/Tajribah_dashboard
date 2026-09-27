/**
 * P3.3 — what a photo's bytes say about it. The fixtures are real product photos (the try-on
 * site's wrist and lifestyle shots) saved in every format a merchant's phone or editor produces.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  GOOD_SHORT_SIDE, MAX_PHOTO_BYTES, MIN_SHORT_SIDE, checkPhoto, dimensions, sha256Hex, sniff,
} from '@/server/modules/ai-jobs/photo-check';

const fixture = (name: string) => new Uint8Array(readFileSync(join(process.cwd(), 'server/modules/ai-jobs/__tests__/fixtures', name)));

test('format and size come from the file itself, in every encoding', () => {
  const cases: [string, string, number, number][] = [
    ['wrist-baseline.jpg', 'jpeg', 1200, 1050],
    ['wrist-progressive.jpg', 'jpeg', 1200, 1050], // SOF2: the frame header most parsers miss
    ['wrist-lossy.webp', 'webp', 1200, 1050], // VP8
    ['lifestyle-extended.webp', 'webp', 1200, 1050], // VP8X (it carries EXIF)
    ['thumb-lossless.webp', 'webp', 400, 350], // VP8L
    ['wrist-thumb.webp', 'webp', 400, 350],
    ['watch-cutout.png', 'png', 95, 213],
  ];
  for (const [name, format, width, height] of cases) {
    const bytes = fixture(name);
    assert.equal(sniff(bytes), format, name);
    assert.deepEqual(dimensions(bytes, format as 'jpeg'), { width, height }, name);
  }
});

test('the verdicts: accepted with a file score, refused with reasons', async () => {
  const photo = fixture('wrist-baseline.jpg');
  const hash = await sha256Hex(photo);
  const good = checkPhoto(photo, photo.length, hash);
  assert.equal(good.accepted, true);
  assert.deepEqual(good.issues, ['low_resolution'], '1050 px short side: accepted, but a sharper photo is better');
  assert.equal(good.score, Math.round(60 + (40 * (1050 - MIN_SHORT_SIDE)) / (GOOD_SHORT_SIDE - MIN_SHORT_SIDE)));

  assert.deepEqual(checkPhoto(photo, photo.length, hash, [hash]).issues, ['duplicate'], 'the same bytes twice add nothing');
  const small = fixture('wrist-thumb.webp');
  assert.deepEqual(checkPhoto(small, small.length, 'x').issues, ['too_small']);
  const cutout = fixture('watch-cutout.png');
  assert.deepEqual(checkPhoto(cutout, cutout.length, 'x').issues, ['too_small']);
  assert.deepEqual(checkPhoto(photo, MAX_PHOTO_BYTES + 1, hash).issues, ['too_large_file']);

  // An iPhone HEIC: an ISO-BMFF `ftyp` box with the `heic` brand.
  const heic = new Uint8Array([0, 0, 0, 24, ...'ftypheic'.split('').map((c) => c.charCodeAt(0)), 0, 0, 0, 0]);
  assert.equal(sniff(heic), 'heic');
  assert.deepEqual(checkPhoto(heic, heic.length, 'x').issues, ['unsupported_format']);
  assert.deepEqual(checkPhoto(new TextEncoder().encode('<html>not a photo</html>'), 24, 'x').issues, ['unsupported_format']);
  assert.deepEqual(checkPhoto(photo.subarray(0, 40), 40, 'x').issues, ['unreadable'], 'a JPEG cut off before its frame header');
});

test('a panorama is refused; a photo at the good size scores full marks', () => {
  // A real PNG header rewritten to other sizes: the checks read only the header.
  const png = fixture('watch-cutout.png').slice();
  const setSize = (w: number, h: number) => {
    new DataView(png.buffer).setUint32(16, w);
    new DataView(png.buffer).setUint32(20, h);
  };
  setSize(4000, 1000);
  assert.deepEqual(checkPhoto(png, png.length, 'x').issues, ['extreme_aspect']);
  setSize(GOOD_SHORT_SIDE, GOOD_SHORT_SIDE);
  assert.deepEqual([checkPhoto(png, png.length, 'x').score, checkPhoto(png, png.length, 'x').issues], [100, []]);
  setSize(MIN_SHORT_SIDE, MIN_SHORT_SIDE);
  assert.deepEqual([checkPhoto(png, png.length, 'x').accepted, checkPhoto(png, png.length, 'x').score], [true, 60]);
  setSize(MIN_SHORT_SIDE - 1, 2000);
  assert.equal(checkPhoto(png, png.length, 'x').accepted, false);
});
