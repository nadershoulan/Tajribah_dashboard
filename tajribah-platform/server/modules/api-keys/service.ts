/**
 * P8 — API keys: a store's keys for its own integrations (the Public API, Enterprise).
 *
 *  - **Shown once.** The key is returned when it is made and never again: only a keyed hash is
 *    stored (like invitation tokens), with its first characters to tell keys apart.
 *  - **Scopes, never more than their maker holds.** A key holds a subset of `API_KEY_SCOPES`
 *    (no money, people, settings, keys, connections or deleting the store) and, when made, only
 *    what the person making it may do.
 *  - **A key acts for the store as its maker, narrowed to its scopes** (`auth.ts`): when the maker
 *    leaves the store the key stops working, a demoted maker's key loses what they lost, and a
 *    read-only store's key cannot write — the same rules as the person, never a way around them.
 *  - **Enterprise.** Making a key needs the plan's `public_api` feature; a store that leaves the
 *    plan keeps its keys listed but they stop working (checked on every use).
 */
import { and, desc, gt, isNull, or } from 'drizzle-orm';
import { apiKeys } from '@/db/schema';
import { API_KEY_PREFIX, API_KEY_SCOPES, API_KEY_VISIBLE, MAX_LIVE_KEYS } from '@/lib/api-keys';
import { secret, uuidv7 } from '@/lib/ids';
import type { ApiKeyView } from '@/lib/view-models';
import { auditedInsert, auditedUpdate } from '@/server/core/audit/audit';
import { keyedHash } from '@/server/core/auth/crypto';
import { assertFeature, entitlementsOf } from '@/server/core/billing/entitlements';
import { errors } from '@/server/core/errors/problem';
import type { TenantContext } from '@/server/core/tenancy/context';
import { memberNames } from '@/server/modules/team/service';

export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type CreateApiKey = { name: string; scopes: string[]; expiresInDays: number | null };

/** The keyed hash a key is stored and found by. */
export const hashApiKey = (authSecret: string, key: string) => keyedHash(authSecret, 'api_key', key);

export function stateOf(row: Pick<ApiKeyRow, 'revokedAt' | 'expiresAt'>, now = new Date()): ApiKeyView['state'] {
  if (row.revokedAt) return 'revoked';
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return 'expired';
  return 'live';
}

function view(row: ApiKeyRow, makers: Map<string, string>, now = new Date()): ApiKeyView {
  return {
    id: row.id, name: row.name, prefix: row.keyPrefix, scopes: row.scopes ?? [],
    createdAt: row.createdAt.toISOString(), createdBy: row.createdBy ? makers.get(row.createdBy) ?? null : null,
    lastUsedAt: row.lastUsedAt?.toISOString() ?? null, expiresAt: row.expiresAt?.toISOString() ?? null,
    revokedAt: row.revokedAt?.toISOString() ?? null, state: stateOf(row, now),
  };
}

const makersOf = (ctx: TenantContext, rows: ApiKeyRow[]) =>
  memberNames(ctx, [...new Set(rows.map((r) => r.createdBy).filter((id): id is string => !!id))]);

/** Every key of the store, newest first — live, expired and revoked (the record of what existed). */
export async function listApiKeys(ctx: TenantContext, now = new Date()): Promise<ApiKeyView[]> {
  ctx.require('api_keys:manage');
  const rows = await ctx.db.find(apiKeys, undefined, { limit: 200, orderBy: desc(apiKeys.id) });
  const makers = await makersOf(ctx, rows);
  return rows.map((row) => view(row, makers, now));
}

/** Make a key. Returns it once, with its view; only its hash is kept. */
export async function createApiKey(ctx: TenantContext, input: CreateApiKey, config: { authSecret: string }, now = new Date()): Promise<{ key: string; apiKey: ApiKeyView }> {
  ctx.require('api_keys:manage');
  if (ctx.readOnly) throw errors.readOnly(ctx.readOnly); // revoking stays open while read-only; making does not
  assertFeature(await entitlementsOf(ctx), 'public_api');
  const name = input.name.trim();
  const fields: Record<string, string[]> = {};
  if (name.length < 1 || name.length > 80) fields.name = ['a name of 1 to 80 characters, so you know where the key is used'];
  const scopes = [...new Set(input.scopes)];
  const allowed = API_KEY_SCOPES as readonly string[];
  if (!scopes.length) fields.scopes = ['at least one'];
  else if (scopes.some((s) => !allowed.includes(s))) fields.scopes = ['a key cannot hold that'];
  else if (scopes.some((s) => !ctx.permissions.has(s as never))) fields.scopes = ['a key cannot do more than you can'];
  if (input.expiresInDays !== null && !(Number.isInteger(input.expiresInDays) && input.expiresInDays >= 1 && input.expiresInDays <= 3650)) {
    fields.expiresInDays = ['whole days, 1 to 3650 — or none'];
  }
  if (Object.keys(fields).length) throw errors.validation(fields);

  const live = await ctx.db.count(apiKeys, and(isNull(apiKeys.revokedAt), or(isNull(apiKeys.expiresAt), gt(apiKeys.expiresAt, now))));
  if (live >= MAX_LIVE_KEYS) throw errors.conflict(`a store keeps at most ${MAX_LIVE_KEYS} live keys — revoke one you no longer use`);

  const key = `${API_KEY_PREFIX}${secret(32)}`;
  // The trail keeps the row without its hash (audit's SECRET_FIELD); the key itself is in no row.
  const row = await auditedInsert(ctx, apiKeys, {
    id: uuidv7(now.getTime()), tenantId: ctx.tenantId, name, keyPrefix: key.slice(0, API_KEY_VISIBLE), keyHash: await hashApiKey(config.authSecret, key),
    scopes: allowed.filter((s) => scopes.includes(s)),
    expiresAt: input.expiresInDays === null ? null : new Date(now.getTime() + input.expiresInDays * 86_400_000),
    createdBy: ctx.actor.userId,
  }, { resourceType: 'api_key' }) as ApiKeyRow;
  return { key, apiKey: view(row, await makersOf(ctx, [row]), now) };
}

/** Revoke a key: it stops working at once. Revoking one already revoked is a 409 that says so. */
export async function revokeApiKey(ctx: TenantContext, id: string, now = new Date()): Promise<ApiKeyView> {
  ctx.require('api_keys:manage');
  const found = await ctx.db.findById(apiKeys, id);
  if (!found) throw errors.notFound('api_key');
  if (found.revokedAt) throw errors.conflict('this key was already revoked');
  const row = await auditedUpdate(ctx, apiKeys, id, { revokedAt: now }, { resourceType: 'api_key' }) as ApiKeyRow;
  return view(row, await makersOf(ctx, [row]), now);
}

