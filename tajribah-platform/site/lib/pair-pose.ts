/**
 * T134.7 — «أرسل إلى شاشتي» sends the shopper's own fit with the photo: where they left the product on their phone, so
 * the computer shows the same picture instead of placing it again. The pose travels as a short header beside the
 * photo, in shares of the photo's width and height (the computer draws the photo at another size), the angle in
 * degrees; it is checked on the way in and on the way out. No pose (an older phone page, or no product): the computer
 * places it itself, as before.
 */
import type { Pose } from './placement';

export const POSE_HEADER = 'X-Tajribah-Pose';

/** Where the product sits, in shares of the photo: centre (x of its width, y of its height), width (of its width), angle. */
export type SharedPose = { x: number; y: number; width: number; angle: number };

const fixed = (n: number) => String(Math.round(n * 10000) / 10000);

/** The header for a pose on a photo of `size` pixels. */
export function poseHeader(pose: Pose, size: { width: number; height: number }): string {
  return [pose.x / size.width, pose.y / size.height, pose.width / size.width, pose.angle].map(fixed).join(',');
}

/** The pose from a header, or null when it is missing or anything about it is wrong. */
export function poseFromHeader(value: string | null | undefined): SharedPose | null {
  if (!value || value.length > 100) return null;
  const parts = value.split(',');
  if (parts.length !== 4 || parts.some((p) => !/^-?\d+(\.\d+)?$/.test(p.trim()))) return null;
  const [x, y, width, angle] = parts.map(Number) as [number, number, number, number];
  // the centre may sit a little outside the photo (dragged to its edge); a width up to three photos wide; a turn or two
  if (x < -0.5 || x > 1.5 || y < -0.5 || y > 1.5 || !(width > 0) || width > 3 || angle < -720 || angle > 720) return null;
  return { x, y, width, angle };
}

/** A shared pose on the studio's stage, where the photo is drawn whole and centred (`W` × `H`). */
export function poseOnStage(p: SharedPose, photo: { width: number; height: number }, stage: { W: number; H: number }): Pose {
  const f = Math.min(stage.W / photo.width, stage.H / photo.height);
  const ox = (stage.W - photo.width * f) / 2, oy = (stage.H - photo.height * f) / 2;
  return { x: ox + p.x * photo.width * f, y: oy + p.y * photo.height * f, width: p.width * photo.width * f, angle: p.angle };
}
