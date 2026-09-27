/**
 * P3.8 — turning a model in 90° steps: one definition for the server that bakes the turn into
 * the file (`server/modules/models/edit.ts`) and the editor that previews it, so what the merchant
 * sees before saving is what the saved file does.
 *
 * Turns are about the fixed axes, x then y then z. `<model-viewer>` previews with its own
 * `orientation` (a YXZ Euler: "roll pitch yaw"), so the preview is converted, not re-derived.
 */
export type Turn = 0 | 90 | 180 | 270;
export type Turns = { x: Turn; y: Turn; z: Turn };
type Quat = [number, number, number, number];

const clean = (v: number) => (Math.abs(v) < 1e-12 ? 0 : v);

function axis(deg: number, i: 0 | 1 | 2): Quat {
  const h = (deg * Math.PI) / 360;
  const q: Quat = [0, 0, 0, Math.cos(h)];
  q[i] = Math.sin(h);
  return q;
}

function mul(a: Quat, b: Quat): Quat {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}

/** The quaternion (x, y, z, w) for turning `x`, then `y`, then `z` degrees about the fixed axes. */
export function turnQuaternion(x: number, y: number, z: number): Quat {
  return mul(axis(z, 2), mul(axis(y, 1), axis(x, 0))).map(clean) as Quat;
}

/** Row-major rotation matrix of a unit quaternion. */
function matrixOf([x, y, z, w]: Quat): number[][] {
  return [
    [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
    [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
    [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
  ];
}

/**
 * The same turn as `<model-viewer>`'s `orientation` attribute ("roll pitch yaw", applied as a YXZ
 * Euler): three.js's matrix → Euler('YXZ') decomposition, in degrees.
 */
export function viewerOrientation(turns: Turns): string {
  const m = matrixOf(turnQuaternion(turns.x, turns.y, turns.z));
  const m23 = Math.max(-1, Math.min(1, m[1]![2]!));
  const pitch = Math.asin(-m23);
  let yaw: number, roll: number;
  if (Math.abs(m23) < 0.9999999) {
    yaw = Math.atan2(m[0]![2]!, m[2]![2]!);
    roll = Math.atan2(m[1]![0]!, m[1]![1]!);
  } else {
    yaw = Math.atan2(-m[2]![0]!, m[0]![0]!);
    roll = 0;
  }
  const deg = (r: number) => `${Math.round(clean((r * 180) / Math.PI))}deg`;
  return `${deg(roll)} ${deg(pitch)} ${deg(yaw)}`;
}

/** The model's width, height and depth after the turn (90° steps swap sides; they never grow). */
export function turnedSize(size: [number, number, number], turns: Turns): [number, number, number] {
  const m = matrixOf(turnQuaternion(turns.x, turns.y, turns.z));
  return [0, 1, 2].map((row) => Math.round((Math.abs(m[row]![0]!) * size[0] + Math.abs(m[row]![1]!) * size[1] + Math.abs(m[row]![2]!) * size[2]) * 10) / 10) as [number, number, number];
}

export const NO_TURN: Turns = { x: 0, y: 0, z: 0 };
export const next = (t: Turn): Turn => (((t + 90) % 360) as Turn);
