/**
 * P4.1 — the analytics event contract on the receiving side.
 *
 * The browser half lives in `widget/src/events.ts` (no dependencies, it ships to every product
 * page); this file imports its constants and wraps them in zod for the collector (P4.2), so the
 * two halves cannot drift: change a limit there and the validation here changes with it.
 *
 * The collector is the trust boundary. Everything in a batch was written by a browser in
 * someone else's shop, which means:
 *  - **The body is not the truth.** `store` is a claim to be looked up, `session` a random
 *    token to be salted and hashed (§7.10), `sentAt` a foreign clock used only to order events
 *    within one batch. The row's `occurred_at` comes from the edge's own clock.
 *  - **Nothing identifying is accepted**, because nothing identifying is in the schema. The IP
 *    address and user agent the request carries are used to derive country and device family
 *    and are then dropped — they are never columns (D5, §7.10).
 *  - **The body arrives as `text/plain`** and the collector parses JSON out of it. That is how
 *    the SDK avoids a CORS preflight it cannot perform (see `BODY_TYPE` in `widget/src/track.ts`),
 *    and it means `Content-Type` says nothing trustworthy about the body. It also means the
 *    endpoint is a public one any page can post to — inherent to beacon analytics, since the
 *    store key is public in the widget — so it is defended with size caps, rate limits and this
 *    schema, not with an auth check that would only look like one.
 *  - **A bad batch is refused whole**, not repaired. A shop that sends nonsense gets a 400 and
 *    the next batch is unaffected; there is nothing here worth salvaging an event for.
 *
 * **Where events land.** The plan says ClickHouse (D5, §7.10); this build writes
 * `analytics_events` and its rollups in Postgres instead, decided before this package and
 * recorded in `docs/ARCHITECTURE.md` — same rule (analytics never touches the merchant's
 * transactional read path), one less store to host, and an event schema kept ClickHouse-shaped
 * so the move is an exporter rather than a rewrite. The row mapping below therefore targets
 * `db/schema/analytics.ts`, not §7.10's DDL. The transport and the insert are P4.2 and P4.3.
 */
import { z } from 'zod';
import type { InferInsertModel } from 'drizzle-orm';
import { analyticsEvents, EVENT_TYPE } from '../../db/schema/analytics';
import { EVENT_SCHEMA_VERSION, EVENT_TYPES, LIMITS } from '../../widget/src/events';

/**
 * The widget sends a subset of what the database can store: `ar_close` and `tryon_share` exist
 * as columns before anything can observe them. The compiler holds the direction that matters —
 * the SDK can never send a type the table cannot hold.
 */
const _sdkTypesFitTheColumn: readonly (typeof EVENT_TYPE)[number][] = EVENT_TYPES;
void _sdkTypesFitTheColumn;

export { EVENT_SCHEMA_VERSION, EVENT_TYPES, LIMITS };
export type { EventBatch, EventType, WireEvent } from '../../widget/src/events';

const shortString = (max: number) => z.string().trim().min(1).max(max);

export const WireEventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  t: z.number().int().min(0).max(24 * 60 * 60 * 1000),
  productId: shortString(LIMITS.productId).optional(),
  durationMs: z.number().int().min(0).max(LIMITS.durationMs).optional(),
  valueMinor: z.number().int().min(0).max(LIMITS.value).optional(),
  currency: z.string().regex(/^[A-Z]{3}$/).optional(),
  arSupported: z.union([z.literal(0), z.literal(1)]).optional(),
  properties: z.record(
    z.string().regex(/^[a-z][a-z0-9_]{0,23}$/),
    shortString(LIMITS.propValue),
  ).refine((p) => Object.keys(p).length <= LIMITS.props, `at most ${LIMITS.props} properties`).optional(),
}).strict();

export const EventBatchSchema = z.object({
  v: z.literal(EVENT_SCHEMA_VERSION),
  store: shortString(64),
  session: z.string().regex(/^[A-Za-z0-9_-]{16,64}$/),
  sdk: shortString(20),
  sentAt: z.number().int().min(0),
  events: z.array(WireEventSchema).min(1).max(LIMITS.batch),
}).strict();

export type ParsedBatch = z.infer<typeof EventBatchSchema>;

/**
 * Parse a request body. Returns the batch, or the reason it was refused — never throws, and
 * never returns a partly valid batch.
 */
export function parseBatch(input: unknown): { ok: true; batch: ParsedBatch } | { ok: false; reason: string } {
  const result = EventBatchSchema.safeParse(input);
  if (result.success) return { ok: true, batch: result.data };
  const first = result.error.issues[0];
  return { ok: false, reason: first ? `${first.path.join('.') || 'body'}: ${first.message}` : 'invalid batch' };
}

/** A row of `analytics_events`, as Drizzle wants it for an insert. */
export type EventRow = InferInsertModel<typeof analyticsEvents>;

/**
 * Everything the collector knows that the browser did not send — and could not be trusted to.
 *
 * `productId` is the notable one: the batch carries the merchant's **own** product reference
 * (`sku-41`), while the column is this store's product uuid. Resolving one to the other is the
 * collector's job (P4.2), and an event for a product this store does not have is dropped there
 * rather than stored with a null.
 */
export type CollectorContext = {
  tenantId: string;
  /** Already salted and hashed with the day's key (§7.10) — never the raw token. */
  sessionId: string;
  /** The edge's clock when the batch arrived. */
  receivedAt: Date;
  /** This store's product uuid for `event.productId`, or null when it resolved to nothing. */
  productId: string | null;
  /** Derived at the edge from the request, never sent by the page. */
  deviceType?: EventRow['deviceType'];
  os?: string | null;
  browser?: string | null;
  country?: string | null;
  region?: string | null;
  referrerHost?: string | null;
};

/** One wire event as a row. Pure, so the mapping is testable without a collector. */
export function toRow(event: z.infer<typeof WireEventSchema>, batch: ParsedBatch, ctx: CollectorContext): EventRow {
  // The batch's own span: `t` counts from when the batch was opened, `sentAt` is when it closed.
  const offsetFromSend = Math.max(0, (batch.events.at(-1)?.t ?? 0) - event.t);
  return {
    tenantId: ctx.tenantId,
    eventType: event.type,
    productId: ctx.productId,
    sessionId: ctx.sessionId,
    // The edge's clock, walked back by the event's place in its batch. The browser's own clock
    // is never stored: it is a foreign number that can be wrong by hours or by design.
    occurredAt: new Date(ctx.receivedAt.getTime() - offsetFromSend),
    deviceType: ctx.deviceType ?? 'unknown',
    os: ctx.os ?? null,
    browser: ctx.browser ?? null,
    country: ctx.country ?? null,
    region: ctx.region ?? null,
    referrerHost: ctx.referrerHost ?? null,
    arSupported: event.arSupported ?? 0,
    durationMs: event.durationMs ?? null,
    // Minor units all the way to the column (bigint), as everywhere else in this codebase.
    valueMinor: event.valueMinor ?? null,
    currency: event.currency ?? null,
    properties: event.properties ?? {},
  };
}
