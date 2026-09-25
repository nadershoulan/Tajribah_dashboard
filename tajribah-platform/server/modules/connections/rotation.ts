/**
 * Rotating `ENCRYPTION_KEY` (filed under P1.3): until envelopes carried a key id, a new key
 * made every stored token unreadable and every merchant had to reconnect.
 *
 * The procedure (docs/DECISIONS.md T16):
 *  1. Set `ENCRYPTION_KEY_PREVIOUS` to the old key and `ENCRYPTION_KEY` to a new one; deploy.
 *  2. Tokens move to the new key when used (`accessTokenFor`), and this sweep — on the
 *     worker's schedule tick — moves the idle ones.
 *  3. When the sweep reports nothing resealed on a tick, remove `ENCRYPTION_KEY_PREVIOUS`.
 *
 * Nothing is audited: the change is the same tokens under another key, and the audit trail
 * must never hold token ciphertext. A row no key opens is counted and left alone — its next
 * use marks it `error` and asks the merchant to reconnect, as before.
 */
import { and, isNotNull, notLike, or } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { storeConnections } from '@/db/schema';
import { encryptionKeyId } from '@/server/core/auth/crypto';
import { log } from '@/server/core/observability/log';
import { withTenant } from '@/server/core/tenancy/rls';
import { vaultKeys } from './service';
import { needsReseal, openTokens, sealTokens } from './vault';

export async function resealConnections(limit = 100): Promise<{ resealed: number; unreadable: number }> {
  const keys = vaultKeys();
  const current = `v2.${await encryptionKeyId(keys.current)}.%`;
  // Platform sweep across tenants: ids and tenants only; each row is re-sealed in its tenant.
  const stale = await unsafeAdminDb()
    .select({ id: storeConnections.id, tenantId: storeConnections.tenantId })
    .from(storeConnections)
    .where(or(
      and(isNotNull(storeConnections.accessTokenEncrypted), notLike(storeConnections.accessTokenEncrypted, current)),
      and(isNotNull(storeConnections.refreshTokenEncrypted), notLike(storeConnections.refreshTokenEncrypted, current)),
    ))
    .limit(limit);

  let resealed = 0;
  let unreadable = 0;
  for (const { id, tenantId } of stale) {
    const outcome = await withTenant(tenantId, async (db) => {
      const row = await db.lockById(storeConnections, id); // a refresh racing us wins or waits
      if (!(await needsReseal(row, keys))) return 'done' as const;
      const tokens = await openTokens(row, keys);
      if (!tokens) return 'unreadable' as const;
      await db.updateById(storeConnections, id, await sealTokens(id, tokens, keys.current));
      return 'resealed' as const;
    });
    if (outcome === 'resealed') resealed += 1;
    if (outcome === 'unreadable') unreadable += 1;
  }
  if (resealed || unreadable) log.info('connection tokens re-sealed', { resealed, unreadable });
  return { resealed, unreadable };
}
