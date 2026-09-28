/**
 * P6.9 — the conformance suite, proven both ways: the reference store (the in-memory store the
 * sync engine is tested against) passes every check, and connectors with the mistakes real
 * connectors make are each caught by the check meant for them.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { errors } from '@/server/core/errors/problem';
import { FakeStore } from '@/server/testing/fake-store';
import { CONFORMANCE_CHECKS, describeConformance, type ConformanceSubject } from '@/server/connectors/conformance';
import type { ExternalProduct, Page, TokenSet } from '@/server/connectors/types';

/** A subject from any FakeStore-like class: holds the catalogue, can be down, refuses one token. */
function subject(name: string, make: () => FakeStore): ConformanceSubject {
  return {
    name,
    async start(catalogue) {
      const store = make();
      for (const p of catalogue) store.products.set(p.externalId, { ...p, images: p.images.map((i) => ({ ...i })) });
      store.revoked.add('refresh-revoked');
      return {
        connector: store,
        accessToken: 'access-ok',
        tokens: { accessToken: 'access-ok', refreshToken: 'refresh-ok' },
        revokedTokens: { accessToken: 'access-old', refreshToken: 'refresh-revoked' },
        setDown: (down) => { store.down = down; },
        change: (id, patch, at) => store.change(id, patch, at),
      };
    },
  };
}

// The reference: every check passes.
describeConformance(subject('reference store', () => new FakeStore('salla', 100)), test);

// ------------------------------------------------------------------ connectors with real-world mistakes

/** Pages by position in "recently changed" order — an edit moves products across pages. */
class OffsetPaged extends FakeStore {
  override async listProducts(_t: string, cursor: string | null, since?: Date | null): Promise<Page<ExternalProduct>> {
    if (this.down) throw errors.upstream(this.provider, new Error('down'));
    const all = [...this.products.values()].filter((p) => !since || p.updatedAt >= since)
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime() || a.externalId.localeCompare(b.externalId));
    const from = cursor ? Number(cursor) : 0;
    const items = all.slice(from, from + 100);
    return { items, next: from + 100 < all.length ? String(from + 100) : null, total: all.length };
  }
}
/** Keyset on (change time, id), oldest first: an edited product comes round again — listed twice. */
class KeysetByChangeTime extends FakeStore {
  override async listProducts(_t: string, cursor: string | null, since?: Date | null): Promise<Page<ExternalProduct>> {
    if (this.down) throw errors.upstream(this.provider, new Error('down'));
    const key = (p: ExternalProduct) => `${String(p.updatedAt.getTime()).padStart(15, '0')}|${p.externalId}`;
    const all = [...this.products.values()].filter((p) => !since || p.updatedAt >= since).sort((a, b) => key(a).localeCompare(key(b)));
    const after = cursor ? all.filter((p) => key(p) > cursor) : all;
    const items = after.slice(0, 100);
    return { items, next: after.length > 100 ? key(items.at(-1)!) : null, total: all.length };
  }
}
/** Keyset on (change time, id), newest first: a product edited before its page is reached jumps behind the cursor — missed. */
class NewestFirstKeyset extends FakeStore {
  override async listProducts(_t: string, cursor: string | null, since?: Date | null): Promise<Page<ExternalProduct>> {
    if (this.down) throw errors.upstream(this.provider, new Error('down'));
    const key = (p: ExternalProduct) => `${String(p.updatedAt.getTime()).padStart(15, '0')}|${p.externalId}`;
    const all = [...this.products.values()].filter((p) => !since || p.updatedAt >= since).sort((a, b) => key(b).localeCompare(key(a)));
    const after = cursor ? all.filter((p) => key(p) < cursor) : all;
    const items = after.slice(0, 100);
    return { items, next: after.length > 100 ? key(items.at(-1)!) : null, total: all.length };
  }
}
/** Calls the store's API directly: an outage surfaces as whatever fetch threw. */
class RawFetchErrors extends FakeStore {
  override async listProducts(t: string, c: string | null, s?: Date | null) {
    if (this.down) throw new TypeError('fetch failed');
    return super.listProducts(t, c, s);
  }
  override async getProduct(t: string, id: string) {
    if (this.down) throw new TypeError('fetch failed');
    return super.getProduct(t, id);
  }
}
/** Answers an outage with an empty page. */
class SwallowsOutages extends FakeStore {
  override async listProducts(t: string, cursor: string | null, since?: Date | null): Promise<Page<ExternalProduct>> {
    if (this.down) return { items: [], next: null };
    return super.listProducts(t, cursor, since);
  }
  override async getProduct(t: string, id: string) { return this.down ? null : super.getProduct(t, id); }
}
/** Money in riyals, not halalas. */
class MajorUnits extends FakeStore {
  override async listProducts(t: string, c: string | null, s?: Date | null) {
    const page = await super.listProducts(t, c, s);
    return { ...page, items: page.items.map((p) => ({ ...p, priceMinor: p.priceMinor === null ? null : p.priceMinor / 100 })) };
  }
}
/** Reads the default-language name only. */
class DropsArabic extends FakeStore {
  override async listProducts(t: string, c: string | null, s?: Date | null) {
    const page = await super.listProducts(t, c, s);
    return { ...page, items: page.items.map((p) => ({ ...p, nameAr: null })) };
  }
}
/** `since` as strictly-after: products changed at that very moment are missed. */
class StrictSince extends FakeStore {
  override async listProducts(t: string, c: string | null, s?: Date | null) {
    const page = await super.listProducts(t, c, s);
    return s ? { ...page, items: page.items.filter((p) => p.updatedAt.getTime() > s.getTime()) } : page;
  }
}
/** Treats a missing product as an error. */
class ThrowsOnMissing extends FakeStore {
  override async getProduct(t: string, id: string) {
    const found = await super.getProduct(t, id);
    if (!found) throw errors.notFound('product');
    return found;
  }
}
/** Reports the page's size as the total. */
class PageTotal extends FakeStore {
  override async listProducts(t: string, c: string | null, s?: Date | null) {
    const page = await super.listProducts(t, c, s);
    return { ...page, total: page.items.length };
  }
}
/** A revoked token surfaces as a plain error. */
class GenericRevoke extends FakeStore {
  override async refresh(tokens: TokenSet) {
    if (tokens.refreshToken && this.revoked.has(tokens.refreshToken)) throw new Error('401 invalid_grant');
    return super.refresh(tokens);
  }
}
/** On the last page, hands back the cursor it was given. */
class StuckCursor extends FakeStore {
  override async listProducts(t: string, c: string | null, s?: Date | null) {
    const page = await super.listProducts(t, c, s);
    return page.next === null && c !== null ? { ...page, next: c } : page;
  }
}
/** Empty strings where the store has nothing. */
class EmptyStrings extends FakeStore {
  override async listProducts(t: string, c: string | null, s?: Date | null) {
    const page = await super.listProducts(t, c, s);
    return { ...page, items: page.items.map((p) => ({ ...p, sku: p.sku ?? '' })) };
  }
}

const check = (name: string) => {
  const found = CONFORMANCE_CHECKS.find((c) => c.name.startsWith(name));
  assert.ok(found, `no check "${name}"`);
  return found;
};

const CAUGHT: [string, () => FakeStore, string, RegExp][] = [
  ['offset paging', () => new OffsetPaged('zid', 100), 'products changing during a sync', /listed twice|missed/],
  ['keyset on change time (an edit is listed twice)', () => new KeysetByChangeTime('zid', 100), 'products changing during a sync', /listed twice/],
  ['newest first (an edit is missed)', () => new NewestFirstKeyset('zid', 100), 'products changing during a sync', /missed/],
  ['an outage as a raw fetch error', () => new RawFetchErrors('woocommerce', 100), 'a store that is down', /upstream error/],
  ['an outage answered as an empty page', () => new SwallowsOutages('zid', 100), 'a store that is down', /products missing/],
  ['money in riyals', () => new MajorUnits('shopify', 100), 'every product is well formed', /whole minor units/],
  ['money in riyals (round trip)', () => new MajorUnits('shopify', 100), 'products come back exactly', /does not come back/],
  ['Arabic names dropped', () => new DropsArabic('woocommerce', 100), 'products come back exactly', /does not come back/],
  ['since as strictly after', () => new StrictSince('zid', 100), 'since returns everything', /not listed/],
  ['a missing product as an error', () => new ThrowsOnMissing('zid', 100), 'getProduct finds', /not found|Not found|product/i],
  ['the page size as the total', () => new PageTotal('shopify', 100), 'total, when given', /total/],
  ['a revoked token as a plain error', () => new GenericRevoke('shopify', 100), 'refresh returns', /TokenRevokedError/],
  ['a cursor that never ends', () => new StuckCursor('zid', 100), 'lists every product exactly once', /never end/],
  ['empty strings for nothing', () => new EmptyStrings('woocommerce', 100), 'every product is well formed', /never ""/],
  ['pages too big to test paging', () => new FakeStore('salla', 1000), 'lists every product exactly once', /page in 100 or fewer/],
];

for (const [mistake, make, target, message] of CAUGHT) {
  test(`caught: ${mistake} → "${target}…"`, async () => {
    await assert.rejects(() => check(target).run(subject(mistake, make)), (error: Error) => {
      assert.match(error.message, message, `caught, but with an unhelpful message: ${error.message}`);
      return true;
    });
  });
}

test('each mistake fails only where it should: the reference store passes everything the others fail', async () => {
  for (const c of CONFORMANCE_CHECKS) await c.run(subject('reference', () => new FakeStore('salla', 100)));
  // An offset-paged store with no edits during the sync still lists everything once — the
  // check that catches it is the one about edits, not the plain listing.
  await check('lists every product exactly once').run(subject('offset paging', () => new OffsetPaged('zid', 100)));
});
