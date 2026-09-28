/**
 * P1.3 — store connections: the connection model on top of the token vault.
 *
 *  - **One store, one account.** `UNIQUE(provider, external_store_id)` is global: a Salla
 *    store already connected to another Tajribah account is refused as a conflict. The
 *    other account is invisible from here (RLS), so the constraint is the only witness.
 *  - **Reconnecting is the same row.** Connecting a store this account already had (after
 *    a revoke, or to refresh scopes) replaces its tokens; products keep their connection.
 *  - **One refresh at a time.** `accessTokenFor` refreshes under a row lock and re-reads
 *    after waiting. Salla rotates refresh tokens, so two jobs refreshing together would
 *    make the second look like a revocation and disconnect a healthy store.
 *  - **A refused refresh is final.** The store revoked us: tokens are wiped, status is
 *    `revoked`, and only the merchant reconnecting fixes it.
 */
import { and, asc, eq, isNull } from 'drizzle-orm';
import { products, storeConnections, type Provider, type StoreConnection } from '@/db/schema';
import type { ConnectionSummary } from '@/lib/view-models';
import { connectorFor, TokenRevokedError, type TokenSet } from '@/server/connectors/types';
import { auditedInsert, auditedUpdate, record } from '@/server/core/audit/audit';
import { loadEnv } from '@/server/core/config/env';
import { AppError, errors, isUniqueViolation } from '@/server/core/errors/problem';
import { assertFeature, entitlementsOf } from '@/server/core/billing/entitlements';
import { log } from '@/server/core/observability/log';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';
import { uuidv7 } from '@/lib/ids';
import { needsReseal, NO_TOKENS, openTokens, sealTokens, type VaultKeys } from './vault';

/** Refresh this long before the store says the token expires: a sync page takes time. */
export const REFRESH_SKEW_MS = 5 * 60_000;

export type ConnectInput = {
  provider: Provider;
  externalStoreId: string;
  storeName?: string | null;
  storeUrl?: string | null;
  tokens: TokenSet;
};

/** The connection cannot be used until the merchant reconnects it. */
export class ReconnectRequiredError extends AppError {
  constructor(readonly connectionStatus: StoreConnection['status']) {
    super('conflict', { detail: `the store connection is ${connectionStatus} — reconnect the store` });
  }
}

/** Seal with the current key; open with it or, during a rotation, the previous one. */
export const vaultKeys = (): VaultKeys => {
  const env = loadEnv();
  return { current: env.ENCRYPTION_KEY, previous: env.ENCRYPTION_KEY_PREVIOUS };
};
const vaultKey = () => vaultKeys().current;

export async function connectStore(ctx: TenantContext, input: ConnectInput): Promise<ConnectionSummary> {
  ctx.require('connections:write');
  // T35: a store platform is a plan feature (Salla and Zid from Growth — the trial runs on Growth —
  // Shopify and WooCommerce from Pro); the feature keys are the provider names.
  assertFeature(await entitlementsOf(ctx), input.provider);
  if (!input.externalStoreId || !input.tokens.accessToken) {
    throw errors.validation({ tokens: ['the store did not hand over an access token'] });
  }
  const profile = { storeName: input.storeName ?? null, storeUrl: input.storeUrl ?? null };
  const existing = await ctx.db.findOne(storeConnections, and(
    eq(storeConnections.provider, input.provider),
    eq(storeConnections.externalStoreId, input.externalStoreId),
  ));

  if (existing) {
    const sealed = await sealTokens(existing.id, input.tokens, vaultKey());
    await auditedUpdate(ctx, storeConnections, existing.id, { ...sealed, ...profile, status: 'active', lastError: null },
      { resourceType: 'store_connection', action: 'connect' });
    return summaryOf(ctx, existing.id);
  }

  const id = uuidv7();
  const sealed = await sealTokens(id, input.tokens, vaultKey());
  try {
    await auditedInsert(ctx, storeConnections, {
      id, tenantId: ctx.tenantId, provider: input.provider, externalStoreId: input.externalStoreId,
      ...profile, ...sealed, status: 'active',
    }, { resourceType: 'store_connection', action: 'connect' });
  } catch (error) {
    if (isUniqueViolation(error)) throw errors.conflict('this store is already connected to another Tajribah account');
    throw error;
  }
  return summaryOf(ctx, id);
}

export async function listConnections(ctx: TenantContext): Promise<ConnectionSummary[]> {
  ctx.require('connections:read');
  const rows = await ctx.db.find(storeConnections, undefined, { orderBy: asc(storeConnections.id) });
  return Promise.all(rows.map((row) => toSummary(ctx, row)));
}

/** Forget the tokens and stop syncing. Products stay; reconnecting picks them up again. */
export async function disconnectStore(ctx: TenantContext, id: string): Promise<void> {
  ctx.require('connections:write');
  await ctx.db.requireById(storeConnections, id);
  await auditedUpdate(ctx, storeConnections, id, { ...NO_TOKENS, status: 'revoked', lastError: null },
    { resourceType: 'store_connection', action: 'disconnect' });
}

/**
 * The store told us it uninstalled the app: tokens wiped, status `revoked`, audited — in the
 * caller's transaction (a webhook handler's). Idempotent: an already revoked connection is
 * left as it is.
 */
export async function revokeIn(ctx: TenantContext, db: TenantDb, id: string, reason: string): Promise<void> {
  const before = await db.lockById(storeConnections, id);
  if (before.status === 'revoked') return;
  const after = await db.updateById(storeConnections, id, { ...NO_TOKENS, status: 'revoked', lastError: reason });
  await record(ctx, { action: 'disconnect', resourceType: 'store_connection', resourceId: id, before, after }, db);
}

/**
 * A usable access token for connection `id`, refreshed first if it expires within
 * `REFRESH_SKEW_MS`. For the sync engine and webhook handlers — **never** behind an
 * endpoint. Throws `ReconnectRequiredError` when only the merchant can fix it, and lets an
 * upstream failure through untouched (nothing is changed; the next attempt retries).
 */
export async function accessTokenFor(ctx: TenantContext, id: string, now: Date = new Date()): Promise<string> {
  const keys = vaultKeys();
  // A refusal is written inside the transaction and thrown after it: throwing inside
  // would roll back the very status change that explains the refusal.
  const outcome = await withTenant(ctx.tenantId, async (db): Promise<{ token: string } | { refused: StoreConnection['status'] }> => {
    const row = await db.lockById(storeConnections, id);
    if (row.status !== 'active') return { refused: row.status };

    const refuse = async (status: 'revoked' | 'expired' | 'error', lastError: string) => {
      const after = await db.updateById(storeConnections, id, { ...NO_TOKENS, status, lastError });
      await record(ctx, { action: 'update', actorType: 'system', resourceType: 'store_connection', resourceId: id, before: row, after }, db);
      log.warn('store connection unusable', { connectionId: id, provider: row.provider, status });
      return { refused: status };
    };

    const tokens = await openTokens(row, keys);
    if (!tokens) return refuse('error', 'stored tokens could not be read — reconnect the store');
    const expiresAt = tokens.expiresAt?.getTime();
    if (expiresAt === undefined || expiresAt - now.getTime() > REFRESH_SKEW_MS) {
      // Opened with a previous key: move it to the current one while the row is locked anyway.
      if (await needsReseal(row, keys)) await db.updateById(storeConnections, id, await sealTokens(id, tokens, keys.current));
      return { token: tokens.accessToken };
    }
    if (!tokens.refreshToken) return refuse('expired', 'access expired and the store gave no refresh token');

    let next: TokenSet;
    try {
      next = await connectorFor(row.provider).refresh(tokens);
    } catch (error) {
      if (error instanceof TokenRevokedError) return refuse('revoked', 'the store revoked access');
      throw error;
    }
    // A store that rotates without re-sending the refresh token means "keep the old one".
    const merged: TokenSet = { ...next, refreshToken: next.refreshToken ?? tokens.refreshToken, scopes: next.scopes ?? tokens.scopes };
    await db.updateById(storeConnections, id, await sealTokens(id, merged, keys.current));
    return { token: merged.accessToken };
  });

  if ('refused' in outcome) throw new ReconnectRequiredError(outcome.refused);
  return outcome.token;
}

// ------------------------------------------------------------------ view mapping

async function summaryOf(ctx: TenantContext, id: string): Promise<ConnectionSummary> {
  return toSummary(ctx, await ctx.db.requireById(storeConnections, id));
}

/** Field by field on purpose: a spread would carry the token columns along. */
async function toSummary(ctx: TenantContext, row: StoreConnection): Promise<ConnectionSummary> {
  const productCount = await ctx.db.count(products, and(eq(products.connectionId, row.id), isNull(products.deletedAt)));
  return {
    id: row.id,
    provider: row.provider,
    storeName: row.storeName ?? row.externalStoreId,
    storeUrl: row.storeUrl,
    status: row.status,
    lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
    healthScore: row.healthScore,
    productCount,
    lastError: row.lastError,
  };
}
