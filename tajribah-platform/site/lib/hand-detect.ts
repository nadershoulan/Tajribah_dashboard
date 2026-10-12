/**
 * T134.5 — find the hand in the shopper's photo, harder than one look. MediaPipe's hand model expects a hand the right
 * way up and reasonably clear; a phone photo is often sideways, or dim. T138: the looks are shared with the face
 * (`detect-views.ts`) — as it is, turned (a quarter, three quarters, a half), shrunk into a margin (a hand too close —
 * and a dim, grainy one), zoomed into crops (a hand far away) — then once more as it is, with the detector told to
 * accept a weaker sighting. The first hand found wins, with the detector's own score; one found small is looked at once
 * more, closer, for more exact points. Its points come back to the photo as it is shown.
 *
 * Runs on the shopper's device (the photo never leaves it). Returns the same shape as MediaPipe's own result, so the
 * studio's code that reads `result.landmarks[0]` is unchanged.
 */
import { browser, closerLook, views, type How, type Makers, type Picture } from './detect-views';

export { turned } from './detect-views';

type Landmark = { x: number; y: number; z?: number };
type Detector = {
  detect(image: Picture): { landmarks: Landmark[][]; handedness?: { score: number }[][] };
  setOptions?(options: { minHandDetectionConfidence?: number }): Promise<void>;
};

export type HandFound = { landmarks: Landmark[][]; score: number; quarters: number; loose: boolean; how: How | 'loose'; closer?: boolean };

const scoreOf = (r: { handedness?: { score: number }[][] }) => r.handedness?.[0]?.[0]?.score ?? 0.5;

export async function detectHand(detector: Detector, img: Picture, { strict = 0.35, loose = 0.15, make = browser }: { strict?: number; loose?: number; make?: Makers } = {}): Promise<HandFound | null> {
  for (const v of views(img, [1, 3, 2], make)) {
    const r = detector.detect(v.picture);
    if (r.landmarks?.length) {
      // a hand found small: once more on a crop round it, for more exact points (T138)
      const near = closerLook((pic) => detector.detect(pic).landmarks ?? null, img, r.landmarks.map((hand) => hand.map((p) => ({ ...p, ...v.back(p) }))), make);
      return { landmarks: near.found, score: scoreOf(r), quarters: v.quarters, loose: false, how: v.how, closer: near.closer };
    }
  }
  if (detector.setOptions) {
    try {
      await detector.setOptions({ minHandDetectionConfidence: loose });
      const r = detector.detect(img);
      if (r.landmarks?.length) return { landmarks: r.landmarks, score: scoreOf(r) * 0.8, quarters: 0, loose: true, how: 'loose' };
    } finally {
      await detector.setOptions({ minHandDetectionConfidence: strict });
    }
  }
  return null;
}
