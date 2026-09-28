/**
 * P6.9 ⭐ — the connector conformance suite: one set of checks every store connector must pass
 * (Salla first; Zid, Shopify and WooCommerce after), so connector #4 cannot behave subtly
 * differently from connector #1. The plan's rule: build this before the second connector.
 *
 * How a connector joins: it brings a **store double** — a stand-in store that holds a given
 * catalogue and answers in that provider's own API (for an HTTP connector: a fetch handler that
 * serves recorded-shape responses built from the catalogue) — and registers
 * `describeConformance(subject)`. The same checks then run against it.
 *
 * Every check is something the sync engine, the webhook pipeline or the connection service relies
 * on (`server/modules/sync/engine.ts`, `connections/service.ts`), not a style preference:
 *  - following `next` from the start lists every product exactly once, and stops;
 *  - page boundaries do not move when a product changes during a sync (the engine resumes from
 *    a stored cursor), and asking for the same page again gives the same page;
 *  - `since` returns everything changed at or after it (the engine overlaps on purpose);
 *  - products come back exactly as the store holds them — money in minor units (T5), Arabic
 *    names intact, status, images, change time — and well formed;
 *  - `total`, when given, is the real count (it drives the progress bar);
 *  - `getProduct` finds a product and answers null — not an error — for one that is gone;
 *  - refresh returns a usable token; a revoked one throws `TokenRevokedError` (only then does
 *    the service ask the merchant to reconnect);
 *  - a store that is down **fails loudly** — never an empty page, which the engine would take
 *    as "the store has no more products" and finish a sync with products missing.
 */
import assert from 'node:assert/strict';
import { AppError } from '../core/errors/problem';
import { PROVIDER } from '../../db/schema/commerce';
import { TokenRevokedError, type Connector, type ExternalProduct, type TokenSet } from './types';

/** A stand-in store holding a catalogue, speaking one provider's API. */
export type StoreDouble = {
  connector: Connector;
  /** An access token the store accepts. */
  accessToken: string;
  /** A token set the store will refresh. */
  tokens: TokenSet;
  /** A token set whose refresh the store refuses for good. */
  revokedTokens: TokenSet;
  /** While true, the store is unreachable or answers with server errors. */
  setDown(down: boolean): void;
  /** The store changes one of its products (a merchant edit) at `at`. */
  change(externalId: string, patch: Partial<ExternalProduct>, at: Date): void;
  close?(): Promise<void>;
};

export type ConformanceSubject = {
  name: string;
  /** A fresh store holding exactly `catalogue`. It must page in pages of 100 or fewer. */
  start(catalogue: ExternalProduct[]): Promise<StoreDouble>;
};

// ------------------------------------------------------------------ the catalogue

const T0 = Date.UTC(2026, 8, 1, 9, 0, 0);
const MIN = 60_000;
/** The moment several products share — `since` is set to it, so "at or after" is tested exactly. */
export const TIE = new Date(T0 + 180 * MIN);

/**
 * 250 products — enough for three pages or more — with the cases connectors get wrong: Arabic
 * and emoji names, no Arabic name, no SKU, a zero price, halalas, no price, another currency,
 * drafts and archived, several images, a long multi-line description, and change-time ties.
 */
export function conformanceCatalogue(): ExternalProduct[] {
  const items: ExternalProduct[] = [];
  for (let i = 1; i <= 250; i++) {
    const externalId = `c${String(i).padStart(4, '0')}`;
    items.push({
      externalId, sku: `SKU-${i}`, name: `Product ${i}`, nameAr: `منتج ${i}`, description: null,
      priceMinor: 10_000 + i, currency: 'SAR', images: [{ url: `https://cdn.example.test/${externalId}.jpg` }],
      status: 'active', updatedAt: new Date(T0 + i * MIN),
    });
  }
  const set = (i: number, patch: Partial<ExternalProduct>) => { items[i - 1] = { ...items[i - 1]!, ...patch }; };
  set(1, { name: 'Gold watch', nameAr: 'ساعة ذهبية ✨', description: 'مقاومة للماء — 50 م.\nالعلبة 38 مم.' });
  set(2, { sku: null, nameAr: null, description: null, priceMinor: 0 });
  set(3, { priceMinor: 125_050 }); // SAR 1,250.50
  set(4, { status: 'draft' });
  set(5, { status: 'archived' });
  set(6, { images: [{ url: 'https://cdn.example.test/c0006-a.jpg', alt: 'من الأمام' }, { url: 'https://cdn.example.test/c0006-b.jpg' }, { url: 'https://cdn.example.test/c0006-c.jpg', alt: 'side' }] });
  set(7, { priceMinor: null, images: [] });
  set(8, { currency: 'USD', priceMinor: 4_999 });
  set(9, { description: `${'‏سطر طويل '.repeat(40)}\n\n\tنهاية` });
  for (const i of [100, 150, 151, 152, 200]) set(i, { updatedAt: TIE }); // ties, across pages
  return items;
}

// ------------------------------------------------------------------ helpers

const MAX_PAGES = 1_000;

/** Follow `next` from the start; fail on a cursor that never ends. */
export async function listAll(double: StoreDouble, since?: Date | null): Promise<{ items: ExternalProduct[]; pages: number; firstTotal: number | null | undefined }> {
  const items: ExternalProduct[] = [];
  let cursor: string | null = null;
  let firstTotal: number | null | undefined;
  for (let pages = 1; pages <= MAX_PAGES; pages++) {
    const page = await double.connector.listProducts(double.accessToken, cursor, since);
    if (pages === 1) firstTotal = page.total;
    items.push(...page.items);
    if (page.next === null) return { items, pages, firstTotal };
    assert.notEqual(page.next, cursor, `the cursor did not move after ${cursor ?? 'the first page'} — the listing would never end`);
    cursor = page.next;
  }
  assert.fail(`still paging after ${MAX_PAGES} pages — the listing never ends`);
}

const ids = (items: ExternalProduct[]) => items.map((p) => p.externalId);
const dupes = (list: string[]) => list.filter((id, i) => list.indexOf(id) !== i);
const comparable = (p: ExternalProduct) => ({ ...p, updatedAt: p.updatedAt instanceof Date ? p.updatedAt.getTime() : Number.NaN, images: p.images.map((i) => ({ url: i.url, ...(i.alt ? { alt: i.alt } : {}) })) });

/** Every listed product as the store holds it — the round trip that catches unit and text slips. */
function sameAsCatalogue(listed: ExternalProduct[], catalogue: ExternalProduct[]): void {
  const held = new Map(catalogue.map((p) => [p.externalId, p]));
  for (const p of listed) {
    const expected = held.get(p.externalId);
    assert.ok(expected, `listed a product the store does not hold: ${p.externalId}`);
    assert.deepEqual(comparable(p), comparable(expected), `${p.externalId} does not come back as the store holds it`);
  }
}

function wellFormed(p: ExternalProduct): void {
  const where = `product ${JSON.stringify(p.externalId)}`;
  assert.ok(typeof p.externalId === 'string' && p.externalId.length > 0, `${where}: an external id is required`);
  assert.ok(typeof p.name === 'string' && p.name.trim().length > 0, `${where}: a name is required`);
  for (const [field, value] of [['sku', p.sku], ['nameAr', p.nameAr], ['description', p.description]] as const) {
    assert.ok(value === null || (typeof value === 'string' && value.length > 0), `${where}: ${field} is a non-empty string or null, never ""`);
  }
  assert.ok(p.priceMinor === null || (Number.isSafeInteger(p.priceMinor) && p.priceMinor >= 0), `${where}: priceMinor is whole minor units (halalas) or null — got ${p.priceMinor}`);
  assert.match(p.currency, /^[A-Z]{3}$/, `${where}: currency is an ISO 4217 code`);
  assert.ok(['active', 'draft', 'archived'].includes(p.status), `${where}: status is active, draft or archived`);
  assert.ok(p.updatedAt instanceof Date && !Number.isNaN(p.updatedAt.getTime()), `${where}: updatedAt is a real Date`);
  assert.ok(Array.isArray(p.images), `${where}: images is a list`);
  for (const image of p.images) assert.match(image.url, /^https:\/\//, `${where}: image URLs are https`);
}

async function rejectsAsUpstream(call: () => Promise<unknown>, what: string): Promise<void> {
  let outcome: unknown;
  try { outcome = await call(); } catch (error) {
    assert.ok(error instanceof AppError && error.code.startsWith('upstream_'), `${what}: must fail as an upstream error (retried by the queue), got ${error instanceof Error ? error.constructor.name + ': ' + error.message : String(error)}`);
    return;
  }
  assert.fail(`${what}: the store is down, but it answered ${JSON.stringify(outcome)?.slice(0, 120)} — an empty answer would finish a sync with products missing`);
}

// ------------------------------------------------------------------ the checks

export type ConformanceCheck = { name: string; run(subject: ConformanceSubject): Promise<void> };

/** Start a store, run, and always close it. */
async function withStore(subject: ConformanceSubject, catalogue: ExternalProduct[], run: (double: StoreDouble) => Promise<void>): Promise<void> {
  const double = await subject.start(catalogue);
  try { await run(double); } finally { await double.close?.(); }
}

export const CONFORMANCE_CHECKS: ConformanceCheck[] = [
  {
    name: 'lists every product exactly once, over more than one page, and stops',
    run: (subject) => withStore(subject, conformanceCatalogue(), async (double) => {
      const catalogue = conformanceCatalogue();
      const { items, pages } = await listAll(double);
      assert.ok(pages >= 3, `the whole catalogue came in ${pages} page(s) — the store double must page in 100 or fewer, so paging is tested`);
      assert.deepEqual(dupes(ids(items)), [], 'listed more than once');
      assert.deepEqual(new Set(ids(items)), new Set(ids(catalogue)), 'products missing or extra');
    }),
  },
  {
    name: 'products come back exactly as the store holds them — minor units, Arabic, status, images, change time',
    run: (subject) => withStore(subject, conformanceCatalogue(), async (double) => {
      sameAsCatalogue((await listAll(double)).items, conformanceCatalogue());
    }),
  },
  {
    name: 'every product is well formed',
    run: (subject) => withStore(subject, conformanceCatalogue(), async (double) => {
      for (const p of (await listAll(double)).items) wellFormed(p);
    }),
  },
  {
    name: 'total, when given, is the real number of products — with and without since',
    run: (subject) => withStore(subject, conformanceCatalogue(), async (double) => {
      const all = await listAll(double);
      if (all.firstTotal != null) assert.equal(all.firstTotal, all.items.length, 'total on the first page');
      const recent = await listAll(double, TIE);
      if (recent.firstTotal != null) assert.equal(recent.firstTotal, recent.items.length, 'total with since');
    }),
  },
  {
    name: 'the same page asked for again is the same page (a sync resumes from a stored cursor)',
    run: (subject) => withStore(subject, conformanceCatalogue(), async (double) => {
      const first = await double.connector.listProducts(double.accessToken, null, null);
      assert.ok(first.next, 'the first page must not be the last');
      const a = await double.connector.listProducts(double.accessToken, first.next, null);
      const b = await double.connector.listProducts(double.accessToken, first.next, null);
      assert.deepEqual(ids(a.items), ids(b.items));
      assert.equal(a.next, b.next);
    }),
  },
  {
    name: 'products changing during a sync do not move the pages: nothing is listed twice or missed',
    run: (subject) => withStore(subject, conformanceCatalogue(), async (double) => {
      const first = await double.connector.listProducts(double.accessToken, null, null);
      assert.ok(first.next, 'the first page must not be the last');
      // A merchant edits a product already fetched and one still to come, while the sync runs.
      const later = new Date(Date.UTC(2026, 8, 2));
      double.change(first.items[0]!.externalId, { name: 'Edited during the sync' }, later);
      const notYet = conformanceCatalogue().find((p) => !first.items.some((i) => i.externalId === p.externalId))!;
      double.change(notYet.externalId, { name: 'Also edited' }, later);
      const rest: ExternalProduct[] = [];
      for (let cursor: string | null = first.next, n = 0; cursor !== null && n < MAX_PAGES; n++) {
        const page = await double.connector.listProducts(double.accessToken, cursor, null);
        rest.push(...page.items);
        cursor = page.next;
      }
      const seen = [...ids(first.items), ...ids(rest)];
      assert.deepEqual(dupes(seen), [], 'listed twice after an edit');
      assert.deepEqual(new Set(seen), new Set(ids(conformanceCatalogue())), 'missed after an edit');
    }),
  },
  {
    name: 'since returns everything changed at or after it',
    run: (subject) => withStore(subject, conformanceCatalogue(), async (double) => {
      const listed = new Set(ids((await listAll(double, TIE)).items));
      const due = conformanceCatalogue().filter((p) => p.updatedAt.getTime() >= TIE.getTime()).map((p) => p.externalId);
      assert.deepEqual(due.filter((id) => !listed.has(id)), [], 'changed at or after since, but not listed');
    }),
  },
  {
    name: 'an empty store lists nothing, in one page',
    run: (subject) => withStore(subject, [], async (double) => {
      const page = await double.connector.listProducts(double.accessToken, null, null);
      assert.deepEqual([page.items.length, page.next], [0, null]);
    }),
  },
  {
    name: 'getProduct finds a product as listed, and answers null for one that does not exist',
    run: (subject) => withStore(subject, conformanceCatalogue(), async (double) => {
      const catalogue = conformanceCatalogue();
      for (const expected of [catalogue[0]!, catalogue[2]!, catalogue[5]!]) {
        const got = await double.connector.getProduct(double.accessToken, expected.externalId);
        assert.ok(got, `${expected.externalId} not found`);
        assert.deepEqual(comparable(got), comparable(expected));
      }
      assert.equal(await double.connector.getProduct(double.accessToken, 'does-not-exist-9999'), null);
    }),
  },
  {
    name: 'refresh returns a usable token; a revoked one throws TokenRevokedError',
    run: (subject) => withStore(subject, conformanceCatalogue(), async (double) => {
      const next = await double.connector.refresh(double.tokens);
      assert.ok(typeof next.accessToken === 'string' && next.accessToken.length > 0, 'an access token');
      if (next.expiresAt) assert.ok(next.expiresAt.getTime() > Date.now() - 60_000, 'not already expired');
      await assert.rejects(() => double.connector.refresh(double.revokedTokens), (error: unknown) => error instanceof TokenRevokedError,
        'a revoked token must throw TokenRevokedError — anything else is retried instead of asking the merchant to reconnect');
    }),
  },
  {
    name: 'a store that is down fails loudly — never an empty page — and is read normally once it is back',
    run: (subject) => withStore(subject, conformanceCatalogue(), async (double) => {
      double.setDown(true);
      await rejectsAsUpstream(() => double.connector.listProducts(double.accessToken, null, null), 'listProducts');
      await rejectsAsUpstream(() => double.connector.getProduct(double.accessToken, 'c0001'), 'getProduct');
      double.setDown(false);
      const page = await double.connector.listProducts(double.accessToken, null, null);
      assert.ok(page.items.length > 0, 'back up: the first page has products');
    }),
  },
  {
    name: 'the connector says which store it speaks to',
    run: (subject) => withStore(subject, [], async (double) => {
      assert.ok((PROVIDER as readonly string[]).includes(double.connector.provider), `unknown provider ${double.connector.provider}`);
    }),
  },
];

/** Register every check as a test, for a connector's own test file. */
export function describeConformance(subject: ConformanceSubject, test: (name: string, fn: () => Promise<void>) => unknown): void {
  for (const check of CONFORMANCE_CHECKS) test(`${subject.name} — ${check.name}`, () => check.run(subject));
}
