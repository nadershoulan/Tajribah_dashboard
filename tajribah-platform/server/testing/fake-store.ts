/**
 * A store behind the `Connector` interface, in memory — what the sync engine is tested
 * against until a real Salla store is available (P1.6).
 *
 * Keyset-paged by external id, so a page boundary never moves when a product changes. It
 * can fail on demand (`failListCalls`) and counts what it was asked, so a test can prove a
 * resumed sync did not re-fetch pages it had already stored.
 */
import type { Provider } from '@/db/schema';
import { errors } from '@/server/core/errors/problem';
import type { Connector, ExternalProduct, Page, TokenSet } from '@/server/connectors/types';

export class FakeStore implements Connector {
  readonly products = new Map<string, ExternalProduct>();
  /** Every `listProducts` call, in order: the cursor it was given. */
  readonly listCalls: (string | null)[] = [];
  /** The next N `listProducts` calls throw `upstream_unavailable`. */
  failListCalls = 0;

  constructor(readonly provider: Provider = 'salla', private readonly pageSize = 100) {}

  /** `count` products `p00001`…, all last changed at `updatedAt`. */
  seed(count: number, updatedAt = new Date('2026-09-01T00:00:00Z')): this {
    for (let i = 1; i <= count; i++) {
      const externalId = `p${String(i).padStart(5, '0')}`;
      this.products.set(externalId, {
        externalId, sku: `SKU-${i}`, name: `Product ${i}`, nameAr: `منتج ${i}`, description: null,
        priceMinor: 1000 + i, currency: 'SAR', images: [{ url: `https://cdn.example.test/${externalId}.jpg` }],
        status: 'active', updatedAt,
      });
    }
    return this;
  }

  change(externalId: string, patch: Partial<ExternalProduct>, updatedAt: Date): void {
    const current = this.products.get(externalId);
    if (!current) throw new Error(`no product ${externalId}`);
    this.products.set(externalId, { ...current, ...patch, updatedAt });
  }

  async refresh(tokens: TokenSet): Promise<TokenSet> {
    return tokens;
  }

  async listProducts(_accessToken: string, cursor: string | null, since?: Date | null): Promise<Page<ExternalProduct>> {
    this.listCalls.push(cursor);
    if (this.failListCalls > 0) {
      this.failListCalls -= 1;
      throw errors.upstream(this.provider, new Error('fake store is down'));
    }
    const matching = [...this.products.values()]
      .filter((p) => !since || p.updatedAt.getTime() >= since.getTime())
      .sort((a, b) => a.externalId.localeCompare(b.externalId));
    const after = cursor === null ? matching : matching.filter((p) => p.externalId > cursor);
    const items = after.slice(0, this.pageSize);
    const next = after.length > this.pageSize ? items[items.length - 1].externalId : null;
    return { items, next, total: matching.length };
  }

  async getProduct(_accessToken: string, externalId: string): Promise<ExternalProduct | null> {
    return this.products.get(externalId) ?? null;
  }
}
