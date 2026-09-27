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
 *  - **A bad batch is refused whole**, not repaired. A shop that sends nonsense gets a 400 and
 *    the next batch is unaffected; there is nothing here worth salvaging an event for.
 *
 * Nothing writes to Postgres: events go to ClickHouse (D5). This file defines the shape; the
 * transport, the buffer and the insert are P4.2 and P4.3.
 */
import { z } from 'zod';
import { EVENT_SCHEMA_VERSION, EVENT_TYPES, LIMITS } from '../../widget/src/events';

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

/**
 * The columns one wire event becomes (§7.10). Written here, next to the schema, so P4.3's
 * insert has one place to follow and the field names are checked by the compiler.
 *
 * `occurred_at` is the edge's clock minus the event's offset within its batch — the browser's
 * own clock is never stored. `session_id`, `device_type`, `os`, `browser`, `country` and
 * `region` are the collector's to derive; they are not in the batch and cannot be.
 */
export type EventRow = {
  tenant_id: string;
  event_type: (typeof EVENT_TYPES)[number];
  product_id: string | null;
  session_id: string;
  occurred_at: Date;
  duration_ms: number;
  value: string;
  currency: string;
  ar_supported: 0 | 1;
  properties: Record<string, string>;
};

/** Everything the collector knows that the browser did not send. */
export type CollectorContext = {
  tenantId: string;
  /** Already salted and hashed with the day's key (§7.10) — never the raw token. */
  sessionId: string;
  /** The edge's clock when the batch arrived. */
  receivedAt: Date;
};

/** One wire event as a row. Pure, so the mapping is testable without a collector. */
export function toRow(event: z.infer<typeof WireEventSchema>, batch: ParsedBatch, ctx: CollectorContext): EventRow {
  // The batch's own span: `t` counts from when the batch was opened, `sentAt` is when it closed.
  const offsetFromSend = Math.max(0, (batch.events.at(-1)?.t ?? 0) - event.t);
  return {
    tenant_id: ctx.tenantId,
    event_type: event.type,
    product_id: event.productId ?? null,
    session_id: ctx.sessionId,
    occurred_at: new Date(ctx.receivedAt.getTime() - offsetFromSend),
    duration_ms: event.durationMs ?? 0,
    // ClickHouse Decimal(12,2) takes a string; minor units are integers, so this is exact.
    value: ((event.valueMinor ?? 0) / 100).toFixed(2),
    currency: event.currency ?? '',
    ar_supported: event.arSupported ?? 0,
    properties: event.properties ?? {},
  };
}
