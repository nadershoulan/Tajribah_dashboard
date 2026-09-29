/**
 * P8 — a request made with an API key: `Authorization: Bearer tjr_…` becomes the store's context,
 * acting as the key's maker and narrowed to the key's scopes (see `service.ts`).
 *
 * Unknown, revoked and expired keys, and keys whose maker has left the store, all get the same
 * 401 — the answer never says which. A suspended store answers as it would to its people (403);
 * a store no longer on a plan with the Public API answers 402. `last_used_at` is written at most
 * once a minute, so a busy integration does not turn every request into a write.
 */
import { eq } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { apiKeys, users } from '@/db/schema';
import { API_KEY_PREFIX } from '@/lib/api-keys';
import type { Permission } from '@/lib/permissions';
import { assertFeature, entitlementsOf } from '@/server/core/billing/entitlements';
import { errors, isAppError } from '@/server/core/errors/problem';
import { currentScope } from '@/server/core/observability/scope';
import { buildTenantContext, type TenantContext } from '@/server/core/tenancy/context';
import { hashApiKey, stateOf } from './service';

const TOUCH_MS = 60_000;
const refused = () => errors.unauthenticated('the API key is not valid');

export async function apiKeyContext(key: string, config: { authSecret: string }, requestId: string, now = new Date()): Promise<TenantContext> {
  if (!key.startsWith(API_KEY_PREFIX) || key.length > 200) throw refused();
  const admin = unsafeAdminDb(); // the key names its store: this read precedes any tenant scope
  const [row] = await admin.select().from(apiKeys).where(eq(apiKeys.keyHash, await hashApiKey(config.authSecret, key))).limit(1);
  if (!row || stateOf(row, now) !== 'live' || !row.createdBy) throw refused();
  const [maker] = await admin.select({ email: users.email, deletedAt: users.deletedAt }).from(users).where(eq(users.id, row.createdBy)).limit(1);
  if (!maker || maker.deletedAt) throw refused();

  let person: TenantContext;
  try {
    person = await buildTenantContext({ actor: { userId: row.createdBy, email: maker.email, isStaff: false }, tenantId: row.tenantId, requestId });
  } catch (error) {
    if (isAppError(error) && error.code === 'not_found') throw refused(); // the maker left the store
    throw error;
  }
  assertFeature(await entitlementsOf(person), 'public_api');

  const scopes = new Set((row.scopes ?? []).filter((s): s is Permission => person.permissions.has(s as Permission)));
  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() >= TOUCH_MS) {
    await person.db.updateById(apiKeys, row.id, { lastUsedAt: now } as never);
  }
  return {
    ...person,
    actorType: 'api_key',
    permissions: scopes,
    require: (permission) => {
      if (!scopes.has(permission)) throw errors.forbidden(`this API key does not have the ${permission} scope`);
      person.require(permission); // and the store's own state (read-only) still applies
    },
    can: (permission) => scopes.has(permission) && person.can(permission),
  };
}

/** The context for a request that carries an API key, or 401. */
export async function apiKeyContextFor(request: Request, config: { authSecret: string }): Promise<TenantContext> {
  const match = /^Bearer\s+(\S+)$/i.exec(request.headers.get('authorization') ?? '');
  if (!match) throw errors.unauthenticated('an API key is required: Authorization: Bearer tjr_…');
  return apiKeyContext(match[1]!, config, currentScope()?.requestId ?? 'unscoped');
}
