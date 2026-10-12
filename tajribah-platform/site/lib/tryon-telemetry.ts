/**
 * T140.5 — real success numbers, with no photo sent (Nader: "how often the wrist is found, and how often shoppers
 * move the product by hand"). The bench (T138) measures detection on our photos; this counts it on shoppers' — and only
 * counts. For each photo the try-on places, one event says what happened: the kind of product, where the photo came
 * from (the camera, an upload, the phone through the QR), whether the product was **found** on it by itself (and by which
 * of the harder looks), or placed where the guide showed, or not placed — and whether the shopper then **moved it by
 * hand**. A share or a save is one more event. That is all: no picture, no point on it, no name, no identity.
 *
 * Sent through the merchant analytics' own collector (`page-events.ts`: the same anonymous batch, a random per-tab
 * token, nothing when the browser signals Do Not Track or Global Privacy Control) as `tryon_capture` and `tryon_share`
 * with `surface: 'tryon'`. Never throws into the page.
 */
import { EVENTS_ENDPOINT, noTracking, sessionToken } from './page-events';

export const TRYON_SDK = 'tryon-1';
const SCHEMA = 1;

export type PhotoSource = 'camera' | 'upload' | 'phone';
/** detected: found by itself; phone: fitted on the phone and sent; guide: where the camera's outline showed; none: placed by hand. */
export type Found = 'detected' | 'phone' | 'guide' | 'none';
export type PhotoOutcome = { kind: string; source: PhotoSource; found: Found; how?: string | null; moved: boolean };
type Pose = { x: number; y: number; width: number; angle: number };

/**
 * Moved by hand: the product's place now against where it was first put — more than a twentieth of its width away,
 * turned more than 4°, or resized by more than 6 %. (A nudge below that is not a correction.)
 */
export function movedFrom(first: Pose | null, now: Pose | null, scale = 1): boolean {
  if (!first || !now) return false;
  const turn = Math.abs(((now.angle - first.angle + 540) % 360) - 180);
  const width = now.width * scale;
  return Math.hypot(now.x - first.x, now.y - first.y) > first.width * 0.05 || turn > 4 || Math.abs(width / first.width - 1) > 0.06;
}

export const photoEvent = (o: PhotoOutcome) => ({
  type: 'tryon_capture' as const, t: 0,
  properties: { surface: 'tryon', kind: o.kind.slice(0, 24), source: o.source, found: o.found, ...(o.how ? { how: o.how.slice(0, 24) } : {}), moved: o.moved ? 'yes' : 'no' },
});
export const shareEvent = (how: 'shared' | 'saved', from: 'studio' | 'camera') => ({
  type: 'tryon_share' as const, t: 0, properties: { surface: 'tryon', how, from },
});
type TryOnEvent = ReturnType<typeof photoEvent> | ReturnType<typeof shareEvent>;

/** The batch, as the collector reads it (exported for the test that holds it to the collector's schema). */
export function tryonBatch(store: string, product: string, events: TryOnEvent[], session: string, now: number) {
  return { v: SCHEMA, store, session, sdk: TRYON_SDK, sentAt: now, events: events.slice(0, 20).map((e) => ({ ...e, productId: product.slice(0, 64) })) };
}

/** Where to count: the store and product the try-on is for, and the collector. */
export type Telemetry = { store: string; product: string; endpoint?: string };

export function sendTryOn(where: Telemetry | null | undefined, events: TryOnEvent[]): void {
  try {
    if (!where || !where.store || !where.product || !events.length || typeof window === 'undefined' || noTracking(navigator as never, window as never)) return;
    const body = JSON.stringify(tryonBatch(where.store, where.product, events, sessionToken(), Date.now()));
    const endpoint = where.endpoint ?? EVENTS_ENDPOINT;
    const blob = new Blob([body], { type: 'text/plain;charset=UTF-8' });
    if (navigator.sendBeacon?.(endpoint, blob)) return;
    void fetch(endpoint, { method: 'POST', body, keepalive: true, mode: 'no-cors', credentials: 'omit', headers: { 'content-type': 'text/plain;charset=UTF-8' } }).catch(() => undefined);
  } catch { /* never into the page */ }
}
