// T138 — the detection bench: how often the site's own detection finds the hand / face on real photos made harder the way a shopper's
// photo goes wrong (dim, blurred, noisy, tilted, far, fingers cut off by the edge, the other hand), and how far the
// product lands from where it should. Ground truth: the clean photo's detection, carried through each known change.
import { FilesetResolver, HandLandmarker, FaceLandmarker } from '@mediapipe/tasks-vision';
import { detectHand } from '../../../site/lib/hand-detect';
import { detectFace } from '../../../site/lib/face-detect';
import { facePoints, handPoints, placeOnFace, ringPlacement, watchPlacement, type Pose } from '../../../site/lib/placement';

type L = { x: number; y: number }[];
type M = [number, number, number, number, number, number]; // canvas convention: x' = a x + c y + e, y' = b x + d y + f
type Made = { canvas: HTMLCanvasElement; m: M };
type Variant = { name: string; make(img: HTMLImageElement, lm: L | null): Made | null };

const ID: M = [1, 0, 0, 1, 0, 0];
const mul = (p: M, q: M): M => [p[0] * q[0] + p[2] * q[1], p[1] * q[0] + p[3] * q[1], p[0] * q[2] + p[2] * q[3], p[1] * q[2] + p[3] * q[3], p[0] * q[4] + p[2] * q[5] + p[4], p[1] * q[4] + p[3] * q[5] + p[5]];
const apply = (m: M, x: number, y: number) => ({ x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] });
const canvasOf = (w: number, h: number) => Object.assign(document.createElement('canvas'), { width: Math.round(w), height: Math.round(h) });
const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });

function corner(img: CanvasImageSource & { width: number; height: number }): string {
  const c = canvasOf(img.width, img.height), g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  const at = (x: number, y: number) => g.getImageData(x, y, 1, 1).data;
  const ps = [at(2, 2), at(c.width - 3, 2), at(2, c.height - 3), at(c.width - 3, c.height - 3)];
  const avg = (k: number) => Math.round(ps.reduce((s, p) => s + p[k]!, 0) / 4);
  return `rgb(${avg(0)},${avg(1)},${avg(2)})`;
}

/** Draw `src` through `m` onto a new w×h canvas filled with the photo's own corner colour, with a canvas filter. */
function draw(src: HTMLImageElement | HTMLCanvasElement, w: number, h: number, m: M, filter = 'none'): HTMLCanvasElement {
  const c = canvasOf(w, h), g = c.getContext('2d')!;
  g.fillStyle = corner(src as HTMLImageElement); g.fillRect(0, 0, c.width, c.height);
  g.filter = filter;
  g.setTransform(...m);
  g.drawImage(src, 0, 0);
  return c;
}

const rotate = (deg: number): Variant => ({
  name: `turn ${deg}°`,
  make(img) {
    const t = (deg * Math.PI) / 180, cos = Math.abs(Math.cos(t)), sin = Math.abs(Math.sin(t));
    const w = img.width * cos + img.height * sin, h = img.width * sin + img.height * cos;
    const m = mul(mul([1, 0, 0, 1, w / 2, h / 2], [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0]), [1, 0, 0, 1, -img.width / 2, -img.height / 2]);
    return { canvas: draw(img, w, h, m), m };
  },
});
const far = (s: number): Variant => ({
  name: `far ×${s}`,
  make(img) { const m: M = [s, 0, 0, s, (img.width * (1 - s)) / 2, (img.height * (1 - s)) / 2]; return { canvas: draw(img, img.width, img.height, m), m }; },
});
const filtered = (name: string, filter: string): Variant => ({ name, make(img) { return { canvas: draw(img, img.width, img.height, ID, filter), m: ID }; } });
const noisy = (sigma: number): Variant => ({
  name: `noise ${sigma}`,
  make(img) {
    const c = draw(img, img.width, img.height, ID), g = c.getContext('2d')!;
    const d = g.getImageData(0, 0, c.width, c.height);
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let i = 0; i < d.data.length; i += 4) {
      const n = Math.sqrt(-2 * Math.log(rnd() + 1e-9)) * Math.cos(2 * Math.PI * rnd()) * sigma;
      d.data[i] += n; d.data[i + 1] += n; d.data[i + 2] += n;
    }
    g.putImageData(d, 0, 0);
    return { canvas: c, m: ID };
  },
});
const mirror: Variant = { name: 'other hand (mirror)', make(img) { const m: M = [-1, 0, 0, 1, img.width, 0]; return { canvas: draw(img, img.width, img.height, m), m }; } };
/** The fingers cut off by the photo's edge, at a share of the way from the base knuckle (9) to the middle joint (10). */
const cut = (share: number): Variant => ({
  name: share >= 1 ? 'fingers cut at middle joints' : 'fingers cut just past knuckles',
  make(img, lm) {
    if (!lm) return null;
    const px = (i: number) => ({ x: lm[i]!.x * img.width, y: lm[i]!.y * img.height });
    const w0 = px(0), m9 = px(9), p10 = px(10);
    const at = { x: m9.x + (p10.x - m9.x) * share, y: m9.y + (p10.y - m9.y) * share };
    const ux = m9.x - w0.x, uy = m9.y - w0.y;
    if (Math.abs(ux) >= Math.abs(uy)) {
      if (ux > 0) return { canvas: draw(img, at.x, img.height, ID), m: ID };
      const m: M = [1, 0, 0, 1, -at.x, 0]; return { canvas: draw(img, img.width - at.x, img.height, m), m };
    }
    if (uy > 0) return { canvas: draw(img, img.width, at.y, ID), m: ID };
    const m: M = [1, 0, 0, 1, 0, -at.y]; return { canvas: draw(img, img.width, img.height - at.y, m), m };
  },
});
const then = (a: Variant, b: Variant): Variant => ({
  name: `${a.name} + ${b.name}`,
  make(img, lm) {
    const first = a.make(img, lm); if (!first) return null;
    const asImg = first.canvas as unknown as HTMLImageElement;
    const lm2 = lm ? lm.map((p) => { const q = apply(first.m, p.x * img.width, p.y * img.height); return { x: q.x / first.canvas.width, y: q.y / first.canvas.height }; }) : null;
    const second = b.make(asImg, lm2); if (!second) return null;
    return { canvas: second.canvas, m: mul(second.m, first.m) };
  },
});

const clean: Variant = { name: 'clean', make(img) { return { canvas: draw(img, img.width, img.height, ID), m: ID }; } };
const HAND_VARIANTS: Variant[] = [
  clean, filtered('dim', 'brightness(0.35)'), filtered('dark', 'brightness(0.2)'), filtered('flat light', 'contrast(0.35)'),
  filtered('blur', 'blur(3px)'), noisy(28), mirror,
  rotate(30), rotate(-30), rotate(45), rotate(-60), rotate(90), rotate(135), rotate(180),
  far(0.5), far(0.3), far(0.2), cut(1), cut(0.35),
  then(rotate(30), filtered('dim', 'brightness(0.35)')), then(far(0.4), filtered('dim', 'brightness(0.35)')),
  then(cut(0.35), rotate(-30)), then(far(0.4), rotate(45)), then(cut(0.35), filtered('dim', 'brightness(0.35)')),
  then(filtered('dim', 'brightness(0.5)'), noisy(28)), noisy(40), then(filtered('dark', 'brightness(0.3)'), noisy(20)),
];
const FACE_VARIANTS: Variant[] = [
  clean, filtered('dim', 'brightness(0.35)'), filtered('dark', 'brightness(0.2)'), filtered('flat light', 'contrast(0.35)'),
  filtered('blur', 'blur(3px)'), noisy(28), mirror, rotate(30), rotate(-45), rotate(90), rotate(-90),
  far(0.5), far(0.3), far(0.2), then(rotate(30), filtered('dim', 'brightness(0.35)')), then(far(0.4), rotate(-30)), then(noisy(28), filtered('dim', 'brightness(0.5)')),
];

const shortTurn = (a: number) => Math.abs(((a + 540) % 360) - 180);
const flat = { scale: 1, ox: 0, oy: 0 };
function compare(pred: Pose, exp: Pose) {
  return { pos: Math.hypot(pred.x - exp.x, pred.y - exp.y) / exp.width, ang: shortTurn(pred.angle - exp.angle), size: pred.width / exp.width };
}

async function asJpeg(c: HTMLCanvasElement): Promise<HTMLImageElement> { return load(c.toDataURL('image/jpeg', 0.9)); }

export async function run(photos: { file: string; kind: 'hand' | 'face' }[]) {
  const vision = await FilesetResolver.forVisionTasks('/wasm');
  const hand = await HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: '/assets/hand-landmarker.task', delegate: 'CPU' }, runningMode: 'IMAGE', numHands: 1, minHandDetectionConfidence: 0.35 });
  const hands = await HandLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: '/assets/hand-landmarker.task', delegate: 'CPU' }, runningMode: 'IMAGE', numHands: 2, minHandDetectionConfidence: 0.35 });
  const face = await FaceLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: '/assets/face-landmarker.task', delegate: 'CPU' }, runningMode: 'IMAGE', numFaces: 1, minFaceDetectionConfidence: 0.4 });
  const rows: unknown[] = [];
  for (const photo of photos) {
    const img = await load(`/photos/${photo.file}`);
    // the truth: the clean photo, looked at the way the site does
    let truths: L[] = photo.kind === 'hand' ? (hands.detect(img).landmarks as L[]) : ((face.detect(img).faceLandmarks as L[]) ?? []);
    let truthHow = 'clean';
    if (!truths.length) { // too close: shrunk into a margin, then carried back
      const s = 0.6, pad = far(s).make(img, null)!;
      const found = photo.kind === 'hand' ? (hands.detect(pad.canvas).landmarks as L[]) : (face.detect(pad.canvas).faceLandmarks as L[]);
      truths = found.map((hand) => hand.map((p) => ({ x: (p.x * img.width - pad.m[4]) / s / img.width, y: (p.y * img.height - pad.m[5]) / s / img.height })));
      truthHow = 'shrunk';
    }
    const truth = truths[0] ?? null;
    for (const v of photo.kind === 'hand' ? HAND_VARIANTS : FACE_VARIANTS) {
      const made = v.make(img, truth);
      if (!made) { rows.push({ photo: photo.file, variant: v.name, skipped: true }); continue; }
      const pic = await asJpeg(made.canvas);
      const size = { width: pic.naturalWidth, height: pic.naturalHeight };
      const carry = (t: L) => t.map((p) => { const q = apply(made.m, p.x * img.width, p.y * img.height); return { x: q.x / size.width, y: q.y / size.height }; });
      const exps = truths.map(carry);
      const flipped = made.m[0] * made.m[3] - made.m[1] * made.m[2] < 0; // a mirror: the eyes' order flips
      const t0 = performance.now();
      let row: Record<string, unknown> = { photo: photo.file, variant: v.name };
      if (photo.kind === 'hand') {
        const found = await detectHand(hand as never, pic);
        row = { ...row, ms: Math.round(performance.now() - t0), found: !!found, quarters: found?.quarters, loose: found?.loose, how: found?.how, closer: (found as { closer?: boolean } | null)?.closer, score: found ? +found.score.toFixed(2) : null };
        const ph = found ? handPoints(found.landmarks[0] as L, size, flat) : null;
        // either hand of a photo with two is right: the nearest
        const best = ph ? exps.map((e) => handPoints(e, size, flat)!).map((eh) => ({ watch: compare(watchPlacement(ph, 38), watchPlacement(eh, 38)), ring: compare(ringPlacement(ph, 18), ringPlacement(eh, 18)) })).sort((a, b) => a.watch.pos - b.watch.pos)[0] : null;
        if (best) row = { ...row, ...best };
      } else {
        const found = await detectFace(face as never, pic);
        row = { ...row, ms: Math.round(performance.now() - t0), found: !!found, quarters: found?.quarters, how: found?.how, closer: found?.closer };
        const pf = found ? facePoints(found.faceLandmarks[0] as L, size, flat) : null, ef = exps[0] ? facePoints(exps[0], size, flat) : null;
        if (pf && ef) row = { ...row, glasses: compare(placeOnFace('glasses', pf, 140, 0.4), placeOnFace('glasses', ef, 140, 0.4, flipped)), necklace: compare(placeOnFace('necklace', pf, 120, 0.6), placeOnFace('necklace', ef, 120, 0.6)) };
      }
      rows.push(row);
    }
    rows.push({ photo: photo.file, variant: '(truth)', truth: !!truth, hands: truths.length, how: truthHow, landmarks: truths.map((t) => t.map((p) => [+p.x.toFixed(4), +p.y.toFixed(4)])) });
  }
  return rows;
}

(window as unknown as { bench: typeof run }).bench = run;
