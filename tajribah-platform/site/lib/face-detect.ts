/**
 * T134.5 (face) — find the face in the shopper's photo harder than one look, as the hand already is (`hand-detect.ts`):
 * the photo as it is, then turned a quarter, three quarters and a half — a phone photo is often sideways — with each
 * found face's points brought back to the photo as it is shown. Glasses and a necklace use it, in the studio and on the
 * phone page. Runs on the shopper's device.
 *
 * Returns MediaPipe's own shape (`faceLandmarks`), so the code that reads `faceLandmarks[0]` is unchanged.
 */
import { unrotate } from './placement';
import { turned } from './hand-detect';

type Landmark = { x: number; y: number; z?: number };
type Detector = { detect(image: HTMLImageElement | HTMLCanvasElement): { faceLandmarks?: Landmark[][] } };
type Picture = HTMLImageElement | HTMLCanvasElement;

export type FaceFound = { faceLandmarks: Landmark[][]; quarters: number };

export async function detectFace(detector: Detector, img: HTMLImageElement, turn: (img: HTMLImageElement, quarters: number) => Picture = turned): Promise<FaceFound | null> {
  const first = detector.detect(img);
  if (first.faceLandmarks?.length) return { faceLandmarks: first.faceLandmarks, quarters: 0 };
  for (const q of [1, 3, 2]) {
    const r = detector.detect(turn(img, q));
    if (r.faceLandmarks?.length) return { faceLandmarks: r.faceLandmarks.map((face) => face.map((p) => ({ ...p, ...unrotate(p, q) }))), quarters: q };
  }
  return null;
}
