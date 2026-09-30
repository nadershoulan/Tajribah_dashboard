/**
 * T61 — a store's access that arrives before we know which Tajribah account it belongs to, and the
 * ticket that links it — shared by the store platforms that work this way (Salla, Zid).
 *
 *  - **Waiting access** (`store_grants`, admin only): sealed like a connection's tokens and bound to
 *    its row; one row per store and platform. A store already linked takes new access on its
 *    connection instead (a reinstall, a re-authorization), which then works again.
 *  - **Link tickets**: which store, for 10 minutes — and, when the connection was started from a
 *    signed-in Tajribah page, which store and person started it. Signed here, each platform with its
 *    own purpose, so no other token of ours (a session, another platform's ticket) passes as one.
 */
import { and, eq } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { storeConnections, storeGrants, type Provider, type StoreConnection } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import type { TokenSet } from '@/server/connectors/types';
import { record } from '@/server/core/audit/audit';
import { keyedHash, timingSafeEqual } from '@/server/core/auth/crypto';
import { errors, isUniqueViolation } from '@/server/core/errors/problem';
import { log } from '@/server/core/observability/log';
import { systemContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import { vaultKeys } from './service';
import { openTokens, sealTokens } from './vault';

export const LINK_TTL_MS = 10 * 60_000;

/** The connection a store is linked to, whichever account has it (a platform lookup). */
export async function linkedConnection(provider: Provider, store: string): Promise<Pick<StoreConnection, 'id' | 'tenantId'> | null> {
  const [row] = await unsafeAdminDb().select({ id: storeConnections.id, tenantId: storeConnections.tenantId }).from(storeConnections)
    .where(and(eq(storeConnections.provider, provider), eq(storeConnections.externalStoreId, store))).limit(1);
  return row ?? null;
}

/** New access for a linked store: on its connection, which works again. False when no account has the store. */
export async function renewLinkedTokens(provider: Provider, store: string, tokens: TokenSet, requestId: string): Promise<boolean> {
  const connection = await linkedConnection(provider, store);
  if (!connection) return false;
  const key = vaultKeys().current;
  const ctx = await systemContext({ tenantId: connection.tenantId, requestId, permissions: ['connections:write'], evenIfSuspended: true });
  await withTenant(connection.tenantId, async (db) => {
    const before = await db.lockById(storeConnections, connection.id);
    const after = await db.updateById(storeConnections, connection.id, { ...(await sealTokens(connection.id, tokens, key)), status: 'active', lastError: null });
    await record(ctx, { action: 'update', actorType: 'system', resourceType: 'store_connection', resourceId: connection.id, before, after }, db);
  });
  log.info('store tokens renewed on the linked store', { provider, connectionId: connection.id });
  return true;
}

/** Keep a store's access until it is linked — replacing what was waiting for that store. */
export async function holdGrant(provider: Provider, store: string, tokens: TokenSet): Promise<void> {
  const key = vaultKeys().current;
  for (let attempt = 0; ; attempt++) {
    const [waiting] = await unsafeAdminDb().select({ id: storeGrants.id }).from(storeGrants)
      .where(and(eq(storeGrants.provider, provider), eq(storeGrants.externalStoreId, store))).limit(1);
    try {
      if (waiting) {
        await unsafeAdminDb().update(storeGrants).set({ ...(await sealTokens(waiting.id, tokens, key)), updatedAt: new Date() }).where(eq(storeGrants.id, waiting.id));
      } else {
        const id = uuidv7();
        await unsafeAdminDb().insert(storeGrants).values({ id, provider, externalStoreId: store, ...(await sealTokens(id, tokens, key)) });
      }
      log.info('store access waiting to be linked', { provider });
      return;
    } catch (error) {
      if (!isUniqueViolation(error) || attempt > 0) throw error; // two arrivals at once: the second updates
    }
  }
}

/** The store's waiting access, opened — null when none waits; `tokens` null when it cannot be read. */
export async function waitingGrant(provider: Provider, store: string): Promise<{ id: string; tokens: TokenSet | null } | null> {
  const [grant] = await unsafeAdminDb().select().from(storeGrants)
    .where(and(eq(storeGrants.provider, provider), eq(storeGrants.externalStoreId, store))).limit(1);
  return grant ? { id: grant.id, tokens: await openTokens(grant as unknown as StoreConnection, vaultKeys()) } : null;
}

export async function dropGrant(id: string): Promise<void> {
  await unsafeAdminDb().delete(storeGrants).where(eq(storeGrants.id, id));
}

/** The app was uninstalled before the store was linked: its waiting access goes. */
export async function forgetGrant(provider: Provider, store: string): Promise<void> {
  await unsafeAdminDb().delete(storeGrants).where(and(eq(storeGrants.provider, provider), eq(storeGrants.externalStoreId, store)));
}

// ------------------------------------------------------------------ link tickets

/** Which store; and, when a signed-in Tajribah page started it, which store (`t`) and person (`u`). */
export type LinkTicket = { m: string; e: number; t?: string; u?: string };

const enc = new TextEncoder();
const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(enc.encode(a), enc.encode(b));
const b64 = (text: string) => btoa(String.fromCharCode(...enc.encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text: string) => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));

export async function signLinkTicket(provider: Provider, store: string, secret: string, startedBy?: { t: string; u: string } | null, now = Date.now()): Promise<string> {
  const payload = b64(JSON.stringify({ m: store, e: now + LINK_TTL_MS, ...(startedBy ?? {}) } satisfies LinkTicket));
  return `${payload}.${await keyedHash(secret, `${provider}-link`, payload)}`;
}

export async function verifyLinkTicket(provider: Provider, ticket: string, secret: string, now: number, refused: () => Error): Promise<LinkTicket> {
  const [payload, mac] = ticket.split('.');
  if (!payload || !mac || !sameText(await keyedHash(secret, `${provider}-link`, payload), mac)) throw refused();
  let parsed: LinkTicket;
  try { parsed = JSON.parse(unb64(payload)) as LinkTicket; } catch { throw refused(); }
  if (typeof parsed.e !== 'number' || parsed.e < now || typeof parsed.m !== 'string' || !/^\d{1,19}$/.test(parsed.m)) throw refused();
  return parsed;
}

export const noStoreYet = (platform: string) =>
  errors.conflict(`${platform} has not handed over this store’s access yet — wait a minute and try again, or install Tajribah again from ${platform}`);
