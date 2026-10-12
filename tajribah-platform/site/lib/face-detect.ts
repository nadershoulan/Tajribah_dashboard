/**
 * T134.5 (face) — find the face in the shopper's photo harder than one look, as the hand already is (`hand-detect.ts`).
 * T138: the same looks (`detect-views.ts`) — as it is, turned a quarter and three quarters (a phone photo is often
 * sideways), shrunk into a margin (a face too close, or dim and grainy), zoomed into crops (far away); one found small
 * is looked at once more, closer; each found face's points come back to the photo as it is shown. **Never turned upside
 * down**: the face model fits an upside-down face wrongly (the chin where the forehead is — measured), so that look only
 * ever gave upside-down glasses and a necklace on the forehead; no face found is better than a wrong one. Glasses and a
 * necklace use it, in the studio and on the phone page. Runs on the shopper's device.
 *
 * Returns MediaPipe's own shape (`faceLandmarks`), so the code that reads `faceLandmarks[0]` is unchanged.
 */
import { browser, closerLook, views, type How, type Makers, type Picture } from './detect-views';

type Landmark = { x: number; y: number; z?: number };
type Detector = { detect(image: Picture): { faceLandmarks?: Landmark[][] } };

export type FaceFound = { faceLandmarks: Landmark[][]; quarters: number; how: How; closer?: boolean };

export async function detectFace(detector: Detector, img: Picture, make: Makers = browser): Promise<FaceFound | null> {
  for (const v of views(img, [1, 3], make)) {
    const r = detector.detect(v.picture);
    if (r.faceLandmarks?.length) {
      // a face found small: once more on a crop round it, for more exact points (T138)
      const near = closerLook((pic) => detector.detect(pic).faceLandmarks ?? null, img, r.faceLandmarks.map((face) => face.map((p) => ({ ...p, ...v.back(p) }))), make);
      return { faceLandmarks: near.found, quarters: v.quarters, how: v.how, closer: near.closer };
    }
  }
  return null;
}
