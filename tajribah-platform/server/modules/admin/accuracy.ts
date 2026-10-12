/**
 * T140.5 — real success numbers, for staff (Nader: "how often the wrist is found, and how often shoppers move the
 * product by hand — that tells us real-world accuracy"). Read from the try-on's own anonymous events (`tryon_capture`
 * and `tryon_share` with `surface: 'tryon'`, `site/lib/tryon-telemetry.ts`): no photo, no point, no identity was ever
 * sent — only what happened to each photo.
 *
 *  - **Found by itself**: of the photos the try-on had to place (a photo fitted on the phone and sent is counted
 *    apart — its finding was the phone's), the share it placed on its own; the rest went where the camera's outline
 *    showed, or were placed by hand.
 *  - **Moved by hand**: the share the shopper then corrected (moved, turned or resized more than a nudge) — and of those
 *    found by itself, how many still needed it: the closest to "was the automatic place right?".
 *  - By kind of product and by where the photo came from, and which of the harder looks found it (T138).
 */
import { and, count, eq, gte, sql } from 'drizzle-orm';
import { unsafeAdminDb, type Db } from '@/db/client';
import { analyticsEvents } from '@/db/schema';

const DAY = 86_400_000;
export type Row = { kind: string; source: string; found: string; how: string; moved: string; n: number };
type Part = { name: string; photos: number; foundPct: number | null; movedPct: number | null };
export type Accuracy = {
  days: number; since: string; photos: number; shares: number;
  found: { detected: number; phone: number; guide: number; none: number };
  /** Of the photos the try-on had to place itself, the share found by itself. */
  foundPct: number | null;
  movedPct: number | null;
  /** Of those found by itself, the share the shopper still moved. */
  movedWhenFoundPct: number | null;
  kinds: Part[]; sources: Part[]; looks: { how: string; n: number }[];
};

const pct = (n: number, of: number) => (of > 0 ? Math.round((n / of) * 1000) / 10 : null);

function part(name: string, rows: Row[]): Part {
  const photos = rows.reduce((s, r) => s + r.n, 0);
  const placedHere = rows.filter((r) => r.found !== 'phone').reduce((s, r) => s + r.n, 0);
  const found = rows.filter((r) => r.found === 'detected').reduce((s, r) => s + r.n, 0);
  const moved = rows.filter((r) => r.moved === 'yes').reduce((s, r) => s + r.n, 0);
  return { name, photos, foundPct: pct(found, placedHere), movedPct: pct(moved, photos) };
}

/** The numbers from the grouped events (pure — tested without a database). */
export function summarize(rows: Row[], shares: number, days: number, since: string): Accuracy {
  const sum = (f: (r: Row) => boolean) => rows.filter(f).reduce((s, r) => s + r.n, 0);
  const photos = sum(() => true);
  const found = { detected: sum((r) => r.found === 'detected'), phone: sum((r) => r.found === 'phone'), guide: sum((r) => r.found === 'guide'), none: sum((r) => r.found === 'none') };
  const groups = (key: 'kind' | 'source') => [...new Set(rows.map((r) => r[key]))].map((name) => part(name, rows.filter((r) => r[key] === name))).sort((a, b) => b.photos - a.photos);
  const looks = new Map<string, number>();
  for (const r of rows) if (r.how) looks.set(r.how, (looks.get(r.how) ?? 0) + r.n); // only a photo found by itself carries its look
  return {
    days, since, photos, shares, found,
    foundPct: pct(found.detected, found.detected + found.guide + found.none),
    movedPct: pct(sum((r) => r.moved === 'yes'), photos),
    movedWhenFoundPct: pct(sum((r) => r.found === 'detected' && r.moved === 'yes'), found.detected),
    kinds: groups('kind'), sources: groups('source'),
    looks: [...looks].map(([how, n]) => ({ how, n })).sort((a, b) => b.n - a.n),
  };
}

export async function tryOnAccuracy(days = 30, now = new Date(), db: Db = unsafeAdminDb()): Promise<Accuracy> {
  const since = new Date(now.getTime() - days * DAY);
  // the property names are a fixed list, written into the query (as parameters, Postgres could not match the grouping)
  const prop = (k: 'kind' | 'source' | 'found' | 'how' | 'moved') => sql<string>`coalesce(${analyticsEvents.properties}->>${sql.raw(`'${k}'`)}, '')`;
  const ours = sql`${analyticsEvents.properties}->>'surface' = 'tryon'`;
  const rows = await db.select({ kind: prop('kind'), source: prop('source'), found: prop('found'), how: prop('how'), moved: prop('moved'), n: sql<number>`count(*)::int` })
    .from(analyticsEvents)
    .where(and(eq(analyticsEvents.eventType, 'tryon_capture'), gte(analyticsEvents.occurredAt, since), ours))
    .groupBy(prop('kind'), prop('source'), prop('found'), prop('how'), prop('moved'));
  const [shared] = await db.select({ n: count() }).from(analyticsEvents)
    .where(and(eq(analyticsEvents.eventType, 'tryon_share'), gte(analyticsEvents.occurredAt, since), ours));
  return summarize(rows.map((r) => ({ ...r, n: Number(r.n) })), Number(shared?.n ?? 0), days, since.toISOString());
}
