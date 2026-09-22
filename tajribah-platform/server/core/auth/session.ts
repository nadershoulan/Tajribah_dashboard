/**
 * P0.8 — sessions: issue, verify, rotate, revoke.
 *
 * A session is a refresh-token *family*, and every token ever issued for it is a row in
 * `refresh_tokens`. Rotation marks the presented row used and inserts its successor;
 * presenting **any** already-used token means a copy is in someone else's hands, so the
 * whole family is revoked (§13.6). Remembering only the most recent token would catch the
 * impatient thief and miss the patient one — without full detection, rotation is churn.
 *
 * The access token lives **in memory in the client**, never in localStorage, sessionStorage
 * or a readable cookie: all three are readable by any script on the origin. The refresh
 * token lives in an httpOnly, Secure, SameSite=Lax cookie and is never sent to JavaScript.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { refreshTokens, sessions, users, type Session } from '@/db/schema';
import { secret, uuidv7 } from '@/lib/ids';
import { hashIp, keyedHash, signJwt, verifyJwt, type JwtClaims } from './crypto';
import { errors } from '../errors/problem';
import { log } from '../observability/log';

export const REFRESH_COOKIE = 'tajribah_rt';

export type IssuedSession = {
  session: Session;
  /** Send once, in the httpOnly cookie. Never stored anywhere in its raw form. */
  refreshToken: string;
  accessToken: string;
  expiresInSeconds: number;
};

export type SessionSecrets = {
  authSecret: string;
  accessTtlMinutes: number;
  refreshTtlDays: number;
};

const refreshHash = (secretKey: string, token: string) => keyedHash(secretKey, 'refresh', token);

export async function issueSession(input: {
  userId: string;
  tenantId?: string | null;
  userAgent?: string | null;
  ip?: string | null;
  config: SessionSecrets;
}): Promise<IssuedSession> {
  const db = unsafeAdminDb();
  const token = secret(32);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + input.config.refreshTtlDays * 24 * 3600 * 1000);

  const [session] = await db.insert(sessions).values({
    id: uuidv7(),
    userId: input.userId,
    tenantId: input.tenantId ?? null,
    userAgent: input.userAgent?.slice(0, 200) ?? null,
    ipHash: await hashIp(input.ip, input.config.authSecret),
    expiresAt,
    lastSeenAt: now,
  }).returning();

  await db.insert(refreshTokens).values({
    id: uuidv7(),
    sessionId: session.id,
    userId: session.userId,
    tokenHash: await refreshHash(input.config.authSecret, token),
    expiresAt,
  });

  return {
    session,
    refreshToken: token,
    accessToken: await accessTokenFor(session, input.config),
    expiresInSeconds: input.config.accessTtlMinutes * 60,
  };
}

async function accessTokenFor(session: Session, config: SessionSecrets): Promise<string> {
  return signJwt(
    { sub: session.userId, sid: session.id, tid: session.tenantId },
    config.authSecret,
    config.accessTtlMinutes * 60,
  );
}

/** Verify an access token. Returns claims; the caller still loads the session for anything stateful. */
export async function readAccessToken(token: string, authSecret: string): Promise<JwtClaims> {
  const result = await verifyJwt(token, authSecret);
  if (!result.ok) throw errors.unauthenticated(result.reason === 'expired' ? 'token expired' : undefined);
  return result.claims;
}

export type RotationResult =
  | { ok: true; issued: IssuedSession }
  | { ok: false; reason: 'unknown' | 'expired' | 'revoked' | 'reuse' };

/**
 * Rotate a refresh token.
 *
 * Four outcomes, and the fourth is the one that matters: a token that was already rotated
 * away is evidence of theft, so every session in that family is revoked and the user has to
 * sign in again. That is deliberately harsh — it is the difference between an attacker
 * having a stolen token and an attacker having an account.
 */
export async function rotateSession(input: {
  refreshToken: string;
  config: SessionSecrets;
  userAgent?: string | null;
  ip?: string | null;
  now?: Date;
}): Promise<RotationResult> {
  const db = unsafeAdminDb();
  const now = input.now ?? new Date();
  const presented = await refreshHash(input.config.authSecret, input.refreshToken);

  const [token] = await db
    .select()
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, presented))
    .limit(1);

  if (!token) return { ok: false, reason: 'unknown' };

  if (token.usedAt) {
    // This token was already exchanged. Two parties hold it, and only one of them is the
    // user. Revoking the family is the point of rotation.
    await revokeFamily(token.userId, 'rotation_reuse');
    log.warn('refresh token reuse detected — every session for this user was revoked', {
      userId: token.userId, sessionId: token.sessionId,
    });
    return { ok: false, reason: 'reuse' };
  }

  const [session] = await db.select().from(sessions).where(eq(sessions.id, token.sessionId)).limit(1);
  if (!session || session.revokedAt) return { ok: false, reason: 'revoked' };
  if (token.expiresAt.getTime() <= now.getTime() || session.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: 'expired' };
  }

  const next = secret(32);
  const nextId = uuidv7();
  await db.insert(refreshTokens).values({
    id: nextId,
    sessionId: session.id,
    userId: session.userId,
    tokenHash: await refreshHash(input.config.authSecret, next),
    expiresAt: session.expiresAt,
  });
  await db.update(refreshTokens)
    .set({ usedAt: now, replacedById: nextId })
    .where(eq(refreshTokens.id, token.id));

  const [rotated] = await db.update(sessions).set({
    lastSeenAt: now,
    userAgent: input.userAgent?.slice(0, 200) ?? session.userAgent,
  }).where(eq(sessions.id, session.id)).returning();

  return {
    ok: true,
    issued: {
      session: rotated,
      refreshToken: next,
      accessToken: await accessTokenFor(rotated, input.config),
      expiresInSeconds: input.config.accessTtlMinutes * 60,
    },
  };
}

export async function revokeSession(sessionId: string, reason: Session['revokedReason'] = 'logout'): Promise<void> {
  const db = unsafeAdminDb();
  await db.update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)));
}

/**
 * Logout by refresh cookie: works even when the access token has already expired, which is
 * exactly when a user tends to press "sign out". An unknown token is not an error — the
 * outcome the caller wants (no live session behind this cookie) is already true.
 */
export async function revokeByRefreshToken(refreshToken: string, config: SessionSecrets): Promise<Session | null> {
  const db = unsafeAdminDb();
  const [token] = await db.select().from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, await refreshHash(config.authSecret, refreshToken)))
    .limit(1);
  if (!token) return null;
  const [session] = await db.select().from(sessions).where(eq(sessions.id, token.sessionId)).limit(1);
  if (!session || session.revokedAt) return null; // already signed out: nothing new to record
  await revokeSession(token.sessionId, 'logout');
  return session;
}

/** The signed-in person, as the tenant context needs them. Unauthenticated if gone. */
export async function actorOf(userId: string): Promise<{ userId: string; email: string; isStaff: boolean; fullName: string; emailVerified: boolean; locale: string }> {
  const db = unsafeAdminDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.deletedAt) throw errors.unauthenticated();
  return {
    userId: user.id, email: user.email, isStaff: user.isStaff, fullName: user.fullName,
    emailVerified: !!user.emailVerifiedAt, locale: user.locale,
  };
}

/** Every live session for a user. Used on reuse detection and on password change. */
export async function revokeFamily(userId: string, reason: Session['revokedReason']): Promise<number> {
  const db = unsafeAdminDb();
  const revoked = await db.update(sessions)
    .set({ revokedAt: new Date(), revokedReason: reason })
    .where(and(eq(sessions.userId, userId), isNull(sessions.revokedAt)))
    .returning();
  return revoked.length;
}

/** Load a live session, or fail as unauthenticated. */
export async function requireSession(sessionId: string, now = new Date()): Promise<Session> {
  const db = unsafeAdminDb();
  const [session] = await db.select().from(sessions).where(eq(sessions.id, sessionId)).limit(1);
  if (!session || session.revokedAt || session.expiresAt.getTime() <= now.getTime()) {
    throw errors.unauthenticated();
  }
  return session;
}

/** The tenant switcher: change which store this session is acting for. */
export async function setSessionTenant(sessionId: string, tenantId: string, config: SessionSecrets): Promise<string> {
  const db = unsafeAdminDb();
  const [updated] = await db.update(sessions)
    .set({ tenantId, lastSeenAt: new Date() })
    .where(and(eq(sessions.id, sessionId), isNull(sessions.revokedAt)))
    .returning();
  if (!updated) throw errors.unauthenticated();
  return accessTokenFor(updated, config);
}

/** The cookie attributes, in one place so they cannot drift between routes. */
export function refreshCookie(token: string, config: SessionSecrets, secure = true): string {
  const maxAge = config.refreshTtlDays * 24 * 3600;
  const attributes = [
    `${REFRESH_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    'Path=/api/auth',
    `Max-Age=${maxAge}`,
  ];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function clearRefreshCookie(secure = true): string {
  const attributes = [`${REFRESH_COOKIE}=`, 'HttpOnly', 'SameSite=Lax', 'Path=/api/auth', 'Max-Age=0'];
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

export function readRefreshCookie(cookieHeader: string | null | undefined): string | null {
  const match = new RegExp(`(?:^|;\\s*)${REFRESH_COOKIE}=([^;]+)`).exec(cookieHeader ?? '');
  return match ? decodeURIComponent(match[1]) : null;
}
