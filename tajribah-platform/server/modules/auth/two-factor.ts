/**
 * P1.2b — two-step sign-in with an authenticator app (TOTP), and backup codes.
 *
 * Rules that are not style choices:
 *  - The secret is AES-GCM under `ENCRYPTION_KEY`, **bound to the user** (`totp:{id}`), like
 *    store tokens (P1.3): copied onto another row it does not open. It is shown once, during
 *    setup, and never returned again.
 *  - A code is accepted once: its time step must be newer than the last one accepted, and
 *    that is written with a conditional update, so two racing requests cannot both win.
 *  - Backup codes are stored as keyed hashes and removed when used (compare-and-swap on the
 *    list). They are shown once, when made.
 *  - Turning two-step on or off, or making new backup codes, needs the password again — a
 *    stolen access token alone cannot lock the owner out or strip the protection. Every
 *    change is emailed to the account holder.
 *  - Wrong codes at sign-in count toward the same lockout as wrong passwords.
 *
 * Accounts are not tenant data: this runs on the admin handle, like the rest of auth.
 */
import { and, eq, isNotNull, isNull, lt, notLike, or, sql } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { foldDigits } from '@/lib/money';
import { users, type User } from '@/db/schema';
import { loadEnv } from '@/server/core/config/env';
import { decryptSecret, encryptSecret, encryptionKeyId, keyedHash, verifyPassword } from '@/server/core/auth/crypto';
import type { IssuedSession, SessionSecrets } from '@/server/core/auth/session';
import { matchTotp, newBackupCodes, newTotpSecret, normaliseBackupCode, otpauthUrl } from '@/server/core/auth/totp';
import { errors } from '@/server/core/errors/problem';
import { EMAIL, sendEmail } from '@/server/core/notify/messages';
import { log } from '@/server/core/observability/log';
import { LIMITS, rateLimiter } from '@/server/core/ratelimit/limiter';
import { completeLogin, countFailedLogin, openTwoFactorChallenge } from './service';

const ISSUER = 'Tajribah';

/** The wall clock; tests move time on step by step instead of racing real 30-second windows. */
let clock: () => number = () => Date.now();
export function setTwoFactorClock(next: (() => number) | null): void {
  clock = next ?? (() => Date.now());
}
const boundTo = (userId: string) => `totp:${userId}`;

function keys(): { current: string; all: string[] } {
  const env = loadEnv();
  return { current: env.ENCRYPTION_KEY, all: env.ENCRYPTION_KEY_PREVIOUS ? [env.ENCRYPTION_KEY, env.ENCRYPTION_KEY_PREVIOUS] : [env.ENCRYPTION_KEY] };
}

async function userById(userId: string): Promise<User> {
  const [user] = await unsafeAdminDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.deletedAt) throw errors.unauthenticated();
  return user;
}

async function limit(key: string, rule: { limit: number; windowSeconds: number }): Promise<void> {
  const result = await rateLimiter().hit(key, rule.limit, rule.windowSeconds);
  if (!result.allowed) throw errors.rateLimited(result.retryAfter);
}

/** The signed-in person proving they know the password again. A field error, not a 401. */
async function requirePassword(user: User, password: string): Promise<void> {
  await limit(`2fa-password:${user.id}`, LIMITS.login);
  if (!(await verifyPassword(password, user.passwordHash))) throw errors.validation({ password: ['the password is not right'] });
}

const backupHash = (authSecret: string, code: string) => keyedHash(authSecret, 'backup-code', normaliseBackupCode(code));

async function openSecret(user: User): Promise<string | null> {
  if (!user.totpSecretEncrypted) return null;
  return decryptSecret(user.totpSecretEncrypted, keys().all, boundTo(user.id));
}

/**
 * Accept an authenticator code once. The step is stored only if it is newer than the last
 * one — in the same statement that checks it — so a replay, even a simultaneous one, loses.
 * A secret still under the previous key is re-sealed under the current one on the way.
 */
async function acceptCode(user: User, code: string): Promise<boolean> {
  const secret = await openSecret(user);
  if (!secret) return false;
  const step = await matchTotp(secret, code, { now: clock(), afterStep: user.totpLastStep });
  if (step === null) return false;
  const current = keys().current;
  const resealed = user.totpSecretEncrypted!.startsWith(`v2.${await encryptionKeyId(current)}.`)
    ? {} : { totpSecretEncrypted: await encryptSecret(secret, current, boundTo(user.id)) };
  const won = await unsafeAdminDb().update(users)
    .set({ totpLastStep: step, ...resealed })
    .where(and(eq(users.id, user.id), or(isNull(users.totpLastStep), lt(users.totpLastStep, step))))
    .returning({ id: users.id });
  return won.length === 1;
}

/** Use up one backup code. Compare-and-swap on the stored list: a code works once. */
async function acceptBackupCode(user: User, code: string, authSecret: string): Promise<boolean> {
  const held = user.backupCodesHash ?? [];
  const hash = await backupHash(authSecret, code);
  if (!held.includes(hash)) return false;
  const won = await unsafeAdminDb().update(users)
    .set({ backupCodesHash: held.filter((h) => h !== hash) })
    .where(and(eq(users.id, user.id), sql`${users.backupCodesHash} = ${JSON.stringify(held)}::jsonb`))
    .returning({ id: users.id });
  return won.length === 1;
}

/** Six digits (Arabic-Indic too) → the authenticator; anything else → a backup code. */
const acceptEither = async (user: User, code: string, authSecret: string) =>
  (/^\d{6}$/.test(foldDigits(code).replace(/\s/g, '')) ? acceptCode(user, code) : acceptBackupCode(user, code, authSecret));

async function notify(user: User, on: boolean): Promise<void> {
  await sendEmail(user.email, EMAIL.twoFactorChanged, { on }, user.locale);
  log.info(on ? 'two-factor enabled' : 'two-factor disabled', { userId: user.id });
}

async function newCodes(authSecret: string): Promise<{ codes: string[]; hashes: string[] }> {
  const codes = newBackupCodes();
  return { codes, hashes: await Promise.all(codes.map((c) => backupHash(authSecret, c))) };
}

// ----------------------------------------------------------------------------- API

export type TwoFactorStatus = { enabled: boolean; backupCodesLeft: number };

export async function twoFactorStatus(userId: string): Promise<TwoFactorStatus> {
  const user = await userById(userId);
  return { enabled: user.totpEnabled, backupCodesLeft: user.totpEnabled ? (user.backupCodesHash ?? []).length : 0 };
}

/** AUTH-21, step 1: a new secret for the app to scan. Replaces an unfinished setup. */
export async function startTwoFactorSetup(userId: string, password: string): Promise<{ secret: string; otpauthUrl: string }> {
  const user = await userById(userId);
  if (user.totpEnabled) throw errors.conflict('two-step sign-in is already on');
  await requirePassword(user, password);
  const secret = newTotpSecret();
  await unsafeAdminDb().update(users).set({
    totpSecretEncrypted: await encryptSecret(secret, keys().current, boundTo(userId)),
    totpLastStep: null,
    backupCodesHash: null,
  }).where(and(eq(users.id, userId), eq(users.totpEnabled, false)));
  return { secret, otpauthUrl: otpauthUrl({ secret, account: user.email, issuer: ISSUER }) };
}

/** AUTH-21, step 2 → AUTH-22: the first code proves the app has the secret; backup codes, once. */
export async function enableTwoFactor(userId: string, code: string, authSecret: string): Promise<{ backupCodes: string[] }> {
  const user = await userById(userId);
  if (user.totpEnabled) throw errors.conflict('two-step sign-in is already on');
  if (!user.totpSecretEncrypted) throw errors.conflict('start the setup first');
  await limit(`2fa-code:${userId}`, LIMITS.otpVerify);
  if (!(await acceptCode(user, code))) throw errors.validation({ code: ['that code is not right'] });
  const { codes, hashes } = await newCodes(authSecret);
  await unsafeAdminDb().update(users).set({ totpEnabled: true, backupCodesHash: hashes }).where(eq(users.id, userId));
  await notify(user, true);
  return { backupCodes: codes };
}

/** Turn it off: the password and a current code (or a backup code). */
export async function disableTwoFactor(userId: string, input: { password: string; code: string }, authSecret: string): Promise<void> {
  const user = await userById(userId);
  if (!user.totpEnabled) throw errors.conflict('two-step sign-in is already off');
  await requirePassword(user, input.password);
  await limit(`2fa-code:${userId}`, LIMITS.otpVerify);
  if (!(await acceptEither(user, input.code, authSecret))) throw errors.validation({ code: ['that code is not right'] });
  await unsafeAdminDb().update(users).set({
    totpEnabled: false, totpSecretEncrypted: null, totpLastStep: null, backupCodesHash: null,
  }).where(eq(users.id, userId));
  await notify(user, false);
}

/** A fresh set of backup codes; every old one stops working. */
export async function regenerateBackupCodes(userId: string, password: string, authSecret: string): Promise<{ backupCodes: string[] }> {
  const user = await userById(userId);
  if (!user.totpEnabled) throw errors.conflict('two-step sign-in is off');
  await requirePassword(user, password);
  const { codes, hashes } = await newCodes(authSecret);
  await unsafeAdminDb().update(users).set({ backupCodesHash: hashes }).where(eq(users.id, userId));
  return { backupCodes: codes };
}

/**
 * AUTH-12 / AUTH-14: the second sign-in step. A challenge that is forged, expired or from
 * before a password change is "sign in again" (401 unauthenticated); a wrong code is the
 * usual credential failure and counts toward the lockout.
 */
export async function completeTwoFactorLogin(
  input: { challenge: string; code: string; userAgent?: string | null; ip?: string | null }, config: SessionSecrets,
): Promise<IssuedSession> {
  const user = await openTwoFactorChallenge(input.challenge, config.authSecret);
  if (!user) throw errors.unauthenticated('the sign-in step expired — enter your password again');
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) throw errors.credentials(`locked until ${user.lockedUntil.toISOString()}`);
  await limit(`2fa-code:${user.id}`, LIMITS.otpVerify);
  if (!(await acceptEither(user, input.code, config.authSecret))) {
    await countFailedLogin(user.id, user.failedLoginCount);
    throw errors.credentials('wrong two-factor code');
  }
  return completeLogin(user.id, input, config);
}

/**
 * Key rotation (T16): move authenticator secrets still under the previous `ENCRYPTION_KEY`
 * to the current one, on the worker's tick. Without this, removing the old key would lock
 * every two-step user who did not sign in during the rotation out of their authenticator.
 */
export async function resealTwoFactorSecrets(max = 100): Promise<{ resealed: number; unreadable: number }> {
  const { current } = keys();
  const prefix = `v2.${await encryptionKeyId(current)}.%`;
  const db = unsafeAdminDb();
  const stale = await db.select().from(users)
    .where(and(isNotNull(users.totpSecretEncrypted), notLike(users.totpSecretEncrypted, prefix)))
    .limit(max);
  let resealed = 0;
  let unreadable = 0;
  for (const user of stale) {
    const secret = await openSecret(user);
    if (secret === null) { unreadable += 1; continue; }
    // Only if the row still holds what was read: a sign-in re-sealing it at the same time wins.
    const done = await db.update(users)
      .set({ totpSecretEncrypted: await encryptSecret(secret, current, boundTo(user.id)) })
      .where(and(eq(users.id, user.id), eq(users.totpSecretEncrypted, user.totpSecretEncrypted!)))
      .returning({ id: users.id });
    resealed += done.length;
  }
  if (resealed || unreadable) log.info('two-factor secrets re-sealed', { resealed, unreadable });
  return { resealed, unreadable };
}
