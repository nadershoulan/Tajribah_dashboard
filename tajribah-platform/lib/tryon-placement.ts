/**
 * T134.6 — where the store wants its product on each model photo («جرّبه كما يراه المتسوّق», Nader 2026-10-11: "help
 * the product stay in place and not go outside its zone — outside the model's wrist for a watch — and let the store
 * do it themselves if they don't like the auto place").
 *
 * Per model photo: the **zone** the product's centre may move in (a shopper dragging it cannot take it off the wrist),
 * and the **pose** it starts at — its centre, its angle, and its size as a share of its real size (1 = true size, the
 * studio's promise; a store may adjust it, the editor says so). Coordinates are the studio's stage (1200 × 1050).
 *
 * One parser for the dashboard's save (strict: every problem named), the published config and the studio (lenient:
 * a bad entry is dropped, the built-in placement used instead) — so they can never accept different things.
 */
import type { TryOnKind } from './tryon';
import { STAGE, type ModelId } from '@site/lib/demo-product';

export type Zone = { x: number; y: number; w: number; h: number };
export type SpotPose = { x: number; y: number; angle: number; scale: number };
export type ModelSpot = { zone: Zone; pose: SpotPose };
export type Placement = Partial<Record<ModelId, ModelSpot>>;

/** The model photos each kind is shown on (`modelsFor` in the studio). */
export const MODEL_IDS: Record<TryOnKind, readonly ModelId[]> = {
  watch: ['wrist', 'lifestyle'], glasses: ['face'], ring: ['hand'], necklace: ['neck'], earring: ['ear'], bag: ['bag'],
};
/** How far a store may move a product's size from its real size. */
export const SCALE = { min: 0.5, max: 2 } as const;
/** A zone smaller than this (stage pixels) would pin the product in place. */
export const MIN_ZONE = 16;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const round = (n: number) => Math.round(n * 10) / 10;

/** One model photo's spot, or the reason it is wrong. */
function spotOf(v: unknown): ModelSpot | string {
  if (!isObj(v) || !isObj(v.zone) || !isObj(v.pose)) return 'a zone and a pose';
  const { zone: z, pose: p } = v;
  if (![z.x, z.y, z.w, z.h, p.x, p.y, p.angle, p.scale].every(num)) return 'numbers only';
  const zone = { x: round(z.x as number), y: round(z.y as number), w: round(z.w as number), h: round(z.h as number) };
  if (zone.w < MIN_ZONE || zone.h < MIN_ZONE) return `a zone at least ${MIN_ZONE} pixels each way`;
  if (zone.x < 0 || zone.y < 0 || zone.x + zone.w > STAGE.W || zone.y + zone.h > STAGE.H) return 'a zone inside the photo';
  const pose = { x: round(p.x as number), y: round(p.y as number), angle: round(p.angle as number), scale: Math.round((p.scale as number) * 1000) / 1000 };
  if (pose.x < zone.x || pose.x > zone.x + zone.w || pose.y < zone.y || pose.y > zone.y + zone.h) return 'the product inside its zone';
  if (pose.angle < -180 || pose.angle > 180) return 'an angle between −180° and 180°';
  if (pose.scale < SCALE.min || pose.scale > SCALE.max) return `a size between ${SCALE.min * 100}% and ${SCALE.max * 100}% of its real size`;
  return { zone, pose };
}

/** Strict, for saving: the placement (null when empty), or every problem by model photo. */
export function parsePlacement(kind: TryOnKind, v: unknown): { placement: Placement | null; problems: Record<string, string> } {
  if (v === null || v === undefined) return { placement: null, problems: {} };
  if (!isObj(v)) return { placement: null, problems: { placement: 'one entry per model photo' } };
  const placement: Placement = {};
  const problems: Record<string, string> = {};
  for (const [id, value] of Object.entries(v)) {
    if (!MODEL_IDS[kind].includes(id as ModelId)) { problems[id] = `not a model photo for this kind (${MODEL_IDS[kind].join(', ')})`; continue; }
    const spot = spotOf(value);
    if (typeof spot === 'string') problems[id] = spot;
    else placement[id as ModelId] = spot;
  }
  return { placement: Object.keys(placement).length ? placement : null, problems };
}

/** Lenient, for reading: only the good entries for this kind (null when none). */
export function placementOf(kind: TryOnKind, v: unknown): Placement | null {
  if (!isObj(v)) return null;
  const placement: Placement = {};
  for (const id of MODEL_IDS[kind]) {
    const spot = spotOf(v[id]);
    if (typeof spot !== 'string') placement[id] = spot;
  }
  return Object.keys(placement).length ? placement : null;
}

/** A point (the product's centre) kept inside a zone. */
export function inZone(p: { x: number; y: number }, z: Zone): { x: number; y: number } {
  return { x: Math.max(z.x, Math.min(z.x + z.w, p.x)), y: Math.max(z.y, Math.min(z.y + z.h, p.y)) };
}

export type ZoneHandle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw' | 'move';
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/**
 * The zone after dragging one of its handles by (dx, dy) stage pixels: an edge moves that side, a corner two, the
 * middle moves it whole — never outside the photo, never smaller than `MIN_ZONE`.
 */
export function dragZone(z: Zone, handle: ZoneHandle, dx: number, dy: number): Zone {
  if (handle === 'move') return { ...z, x: clamp(z.x + dx, 0, STAGE.W - z.w), y: clamp(z.y + dy, 0, STAGE.H - z.h) };
  let { x, y, w, h } = z;
  if (handle.includes('w')) { const nx = clamp(x + dx, 0, x + w - MIN_ZONE); w += x - nx; x = nx; }
  if (handle.includes('e')) w = clamp(w + dx, MIN_ZONE, STAGE.W - x);
  if (handle.includes('n')) { const ny = clamp(y + dy, 0, y + h - MIN_ZONE); h += y - ny; y = ny; }
  if (handle.includes('s')) h = clamp(h + dy, MIN_ZONE, STAGE.H - y);
  return { x, y, w, h };
}
