/**
 * T134.3 — MediaPipe's hand and face models for the phone page, made once and kept: one for still photos (IMAGE) and
 * one for the live camera (VIDEO). They run on the shopper's own phone — no picture leaves it to be looked at. The same
 * files the studio uses (`/wasm`, `/assets/*-landmarker.task`); a model is fetched only when a kind needs it.
 */

type Landmark = { x: number; y: number; z?: number };
export type HandModel = {
  detect(image: HTMLImageElement | HTMLCanvasElement): { landmarks: Landmark[][]; handedness?: { score: number }[][] };
  detectForVideo(video: HTMLVideoElement, at: number): { landmarks: Landmark[][]; handedness?: { score: number }[][] };
  setOptions(options: { minHandDetectionConfidence?: number }): Promise<void>;
  close(): void;
};
export type FaceModel = {
  detect(image: HTMLImageElement | HTMLCanvasElement): { faceLandmarks: Landmark[][] };
  detectForVideo(video: HTMLVideoElement, at: number): { faceLandmarks: Landmark[][] };
  close(): void;
};
/** T140.4: Google's pose model — it marks the ears (7, 8), for an earring on a side photo. */
export type PoseModel = {
  detect(image: HTMLImageElement | HTMLCanvasElement): { landmarks: (Landmark & { visibility?: number })[][] };
  close(): void;
};
export type Mode = 'IMAGE' | 'VIDEO';

const made = new Map<string, Promise<unknown>>();

/** A hand or face model for stills or video; the same promise for every caller. `asset` maps a site path to its URL. */
export function model(kind: 'hand', mode: Mode, asset: (path: string) => string): Promise<HandModel>;
export function model(kind: 'face', mode: Mode, asset: (path: string) => string): Promise<FaceModel>;
export function model(kind: 'pose', mode: Mode, asset: (path: string) => string): Promise<PoseModel>;
export function model(kind: 'hand' | 'face' | 'pose', mode: Mode, asset: (path: string) => string): Promise<unknown> {
  const key = `${kind}:${mode}`;
  let found = made.get(key);
  if (!found) {
    found = (async () => {
      const { FilesetResolver, HandLandmarker, FaceLandmarker, PoseLandmarker } = await import('@mediapipe/tasks-vision');
      const vision = await FilesetResolver.forVisionTasks(asset('/wasm'));
      if (kind === 'pose') {
        return PoseLandmarker.createFromOptions(vision, { baseOptions: { modelAssetPath: asset('/assets/pose-landmarker.task'), delegate: 'CPU' }, runningMode: mode, numPoses: 1 });
      }
      return kind === 'hand'
        ? HandLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: asset('/assets/hand-landmarker.task'), delegate: 'CPU' },
          runningMode: mode, numHands: 1, minHandDetectionConfidence: 0.35,
        })
        : FaceLandmarker.createFromOptions(vision, {
          baseOptions: { modelAssetPath: asset('/assets/face-landmarker.task'), delegate: 'CPU' },
          runningMode: mode, numFaces: 1, minFaceDetectionConfidence: 0.4,
        });
    })();
    found.catch(() => made.delete(key)); // a failed download may be tried again
    made.set(key, found);
  }
  return found;
}
