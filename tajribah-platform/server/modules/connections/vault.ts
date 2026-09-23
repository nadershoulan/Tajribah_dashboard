/**
 * P1.3 — the token vault: provider tokens in, sealed columns out, and back.
 *
 * Tokens are AES-256-GCM under `ENCRYPTION_KEY` (§7.5) and **bound to the connection id**:
 * a ciphertext copied onto another row does not open. Nothing outside this module and
 * `service.ts` ever holds a plaintext token, and neither ever logs one or returns one from
 * an endpoint — `ConnectionSummary` has no token field to put it in.
 */
import type { StoreConnection } from '@/db/schema';
import type { TokenSet } from '@/server/connectors/types';
import { decryptSecret, encryptSecret } from '@/server/core/auth/crypto';

export type SealedTokens = Pick<StoreConnection,
  'accessTokenEncrypted' | 'refreshTokenEncrypted' | 'tokenExpiresAt' | 'scopes'>;

/** What a revoked or disconnected connection keeps: nothing that opens the store. */
export const NO_TOKENS: SealedTokens = {
  accessTokenEncrypted: null, refreshTokenEncrypted: null, tokenExpiresAt: null, scopes: null,
};

export async function sealTokens(connectionId: string, tokens: TokenSet, key: string): Promise<SealedTokens> {
  return {
    accessTokenEncrypted: await encryptSecret(tokens.accessToken, key, connectionId),
    refreshTokenEncrypted: tokens.refreshToken ? await encryptSecret(tokens.refreshToken, key, connectionId) : null,
    tokenExpiresAt: tokens.expiresAt ?? null,
    scopes: tokens.scopes ?? null,
  };
}

/**
 * The tokens of `row`, or `null` when they cannot be read — none stored, the key changed,
 * or the ciphertext was altered or moved from another row. The caller cannot tell which,
 * on purpose; every case means the merchant has to reconnect.
 */
export async function openTokens(row: StoreConnection, key: string): Promise<TokenSet | null> {
  if (!row.accessTokenEncrypted) return null;
  const accessToken = await decryptSecret(row.accessTokenEncrypted, key, row.id);
  if (accessToken === null) return null;
  let refreshToken: string | null = null;
  if (row.refreshTokenEncrypted) {
    refreshToken = await decryptSecret(row.refreshTokenEncrypted, key, row.id);
    if (refreshToken === null) return null;
  }
  return { accessToken, refreshToken, expiresAt: row.tokenExpiresAt, scopes: row.scopes };
}
