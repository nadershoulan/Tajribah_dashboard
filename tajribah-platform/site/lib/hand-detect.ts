/**
 * T134.5 — find the hand in the shopper's photo, harder than one look. MediaPipe's hand model expects a hand the right
 * way up and reasonably clear; a phone photo is often sideways, or dim. So: the photo as it is; then turned a quarter,
 * three quarters and a half (each found hand's points brought back with `unrotate`); then once more as it is, with the
 * detector told to accept a weaker sighting. The first hand found wins, with the detector's own score.
 *
 * Runs on the shopper's device (the photo never leaves it). Returns the same shape as MediaPipe's own result, so the
 * studio's code that reads `result.landmarks[0]` is unchanged.
 */
import { unrotate } from './placement';

type Landmark = { x: number; y: number; z?: number };
type Detector = {
  detect(image: HTMLImageElement | HTMLCanvasElement): { landmarks: Landmark[][]; handedness?: { score: number }[][] };
  setOptions?(options: { minHandDetectionConfidence?: number }): Promise<void>;
};

export type HandFound = { landmarks: Landmark[][]; score: number; quarters: number; loose: boolean };

/** The photo turned `quarters` × 90° clockwise, on a canvas. */
function turned(img: HTMLImageElement, quarters: number): HTMLCanvasElement {
  const c = document.createElement('canvas');
  const side = quarters % 2 === 1;
  c.width = side ? img.height : img.width;
  c.height = side ? img.width : img.height;
  const g = c.getContext('2d')!;
  g.translate(c.width / 2, c.height / 2);
  g.rotate((quarters * Math.PI) / 2);
  g.drawImage(img, -img.width / 2, -img.height / 2);
  return c;
}

const scoreOf = (r: { handedness?: { score: number }[][] }) => r.handedness?.[0]?.[0]?.score ?? 0.5;

export async function detectHand(detector: Detector, img: HTMLImageElement, { strict = 0.35, loose = 0.15 } = {}): Promise<HandFound | null> {
  const first = detector.detect(img);
  if (first.landmarks?.length) return { landmarks: first.landmarks, score: scoreOf(first), quarters: 0, loose: false };
  for (const q of [1, 3, 2]) {
    const r = detector.detect(turned(img, q));
    if (r.landmarks?.length) {
      return { landmarks: r.landmarks.map((hand) => hand.map((p) => ({ ...p, ...unrotate(p, q) }))), score: scoreOf(r), quarters: q, loose: false };
    }
  }
  if (detector.setOptions) {
    try {
      await detector.setOptions({ minHandDetectionConfidence: loose });
      const r = detector.detect(img);
      if (r.landmarks?.length) return { landmarks: r.landmarks, score: scoreOf(r) * 0.8, quarters: 0, loose: true };
    } finally {
      await detector.setOptions({ minHandDetectionConfidence: strict });
    }
  }
  return null;
}
