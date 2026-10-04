/**
 * P1.3 — what every store connector implements (Salla first, then Zid, Shopify, Woo).
 *
 * The sync engine, the webhook pipeline and the UI talk to this interface only. The
 * conformance suite (P6) runs the same tests against every implementation, which is what
 * stops connector #4 behaving subtly differently from connector #1.
 */
import type { Provider } from '@/db/schema';

export type TokenSet = {
  accessToken: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  scopes?: string[] | null;
};

/** A product as the store describes it, normalised. Money in minor units (T5). */
export type ExternalProduct = {
  externalId: string;
  sku: string | null;
  name: string;
  nameAr: string | null;
  description: string | null;
  priceMinor: number | null;
  currency: string;
  images: { url: string; alt?: string }[];
  status: 'active' | 'draft' | 'archived';
  /** When the store last changed it — incremental sync compares against this. */
  updatedAt: Date;
  /** T72: millimetres, when the source gives them (a feed's product_width…). Fills an empty size only — the size is the merchant's. */
  dimensions?: { widthMm?: number; heightMm?: number; depthMm?: number } | null;
};

/** `total`, when the store reports it, is what makes progress a percentage. */
export type Page<T> = { items: T[]; next: string | null; total?: number | null };

export interface Connector {
  readonly provider: Provider;
  /** Exchange a refresh token. Throws `TokenRevokedError` when the store refuses for good. */
  refresh(tokens: TokenSet): Promise<TokenSet>;
  listProducts(accessToken: string, cursor: string | null, since?: Date | null): Promise<Page<ExternalProduct>>;
  getProduct(accessToken: string, externalId: string): Promise<ExternalProduct | null>;
}

/** The store revoked access (uninstall, password change): only the merchant can fix it. */
export class TokenRevokedError extends Error {}

const registry = new Map<Provider, Connector>();

export function registerConnector(connector: Connector): void {
  registry.set(connector.provider, connector);
}

export function connectorFor(provider: Provider): Connector {
  const connector = registry.get(provider);
  if (!connector) throw new Error(`no connector registered for "${provider}"`);
  return connector;
}

/** Tests only. */
export function clearConnectors(): void {
  registry.clear();
}
