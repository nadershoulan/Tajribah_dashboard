/**
 * P0.8 — the authentication flows.
 *
 * Rules that are not style choices:
 *  - **One message for every credential failure.** Unknown email, wrong password, locked
 *    account and non-member must be indistinguishable to the caller (§13.6). Only the log
 *    knows which it was.
 *  - Registration creates the user, the store and the owner membership together. A user
 *    with no store cannot do anything, and a store with no owner cannot be recovered.
 *  - A password change revokes every session the user has.
 *  - `?next=` is validated against an allow-list — it was a live open redirect once.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import {
  auditLogs, tenantMemberships, tenants, users, verificationTokens,
  type Tenant, type User,
} from '@/db/schema';
import { secret, uuidv7 } from '@/lib/ids';
import { foldDigits } from '@/lib/money';
import { generatedSlug, nextAvailable, slugify } from '@/lib/slug';
import { TRIAL_DAYS } from '@/lib/plans';
import { hashPassword, keyedHash, needsRehash, otpCode, timingSafeEqual, verifyPassword } from '@/server/core/auth/crypto';
import {
  issueSession, revokeFamily, type IssuedSession, type SessionSecrets,
} from '@/server/core/auth/session';
import { errors } from '@/server/core/errors/problem';
import { log } from '@/server/core/observability/log';
import { LIMITS, rateLimiter } from '@/server/core/ratelimit/limiter';
import { joinTeam, openInvitation } from '@/server/modules/team/service';

const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MINUTES = 15;

export type RegisterInput = {
  email: string;
  password: string;
  fullName: string;
  storeName: string;
  locale?: 'ar' | 'en';
  phone?: string;
  userAgent?: string | null;
  ip?: string | null;
};

/**
 * T49 — sign-up from a team invitation: the account joins the inviting store in the invited role and
 * gets **no store of its own** (before, every sign-up made a store, so an invitee started with an
 * empty one). The invitation must be open and for this very address; the email counts as confirmed,
 * since the link reached that inbox. Wrong, used, expired or someone else's are one answer.
 */
export async function registerByInvitation(input: Omit<RegisterInput, 'storeName'> & { invitation: string }, config: SessionSecrets): Promise<Omit<RegisterResult, 'emailVerificationToken' | 'slugNeedsConfirmation'>> {
  const db = unsafeAdminDb();
  const email = normaliseEmail(input.email);
  const limit = await rateLimiter().hit(`register:${input.ip ?? 'unknown'}`, LIMITS.register.limit, LIMITS.register.windowSeconds);
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfter);
  const invitation = await openInvitation(input.invitation, config.authSecret);
  if (!invitation || invitation.email !== email) throw errors.notFound('invitation');
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) throw errors.conflict('this email already has an account — sign in instead');

  const [user] = await db.insert(users).values({
    id: uuidv7(), email, fullName: input.fullName, passwordHash: await hashPassword(input.password),
    locale: input.locale ?? 'ar', phone: input.phone ? normalisePhone(input.phone) : null,
    emailVerifiedAt: new Date(), // the invitation link reached this inbox
  }).returning();
  await joinTeam(invitation, user!);
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, invitation.tenantId)).limit(1);
  const session = await issueSession({ userId: user!.id, tenantId: invitation.tenantId, userAgent: input.userAgent, ip: input.ip, config });
  log.info('joined by invitation', { tenantId: invitation.tenantId, userId: user!.id });
  return { user: user!, tenant: tenant!, session };
}

export type RegisterResult = {
  user: User;
  tenant: Tenant;
  session: IssuedSession;
  /** True when the slug could not be derived from the store name and must be confirmed. */
  slugNeedsConfirmation: boolean;
  emailVerificationToken: string;
};

/**
 * A new store on its own 14-day trial, starting at the onboarding's store step — for a new
 * account (sign-up) and for another store of an existing one (T30: every store gets its trial).
 */
async function createTrialStore(db: ReturnType<typeof unsafeAdminDb>, storeName: string, locale: 'ar' | 'en' | undefined): Promise<{ tenant: Tenant; derived: string | null }> {
  const derived = slugify(storeName);
  const taken = new Set((await db.select({ slug: tenants.slug }).from(tenants)).map((r) => r.slug));
  const slug = nextAvailable(derived ?? generatedSlug(), taken);
  const now = new Date();
  const [tenant] = await db.insert(tenants).values({
    id: uuidv7(),
    slug,
    name: storeName,
    nameAr: locale === 'en' ? null : storeName,
    status: 'trial',
    trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 24 * 3600 * 1000),
    locale: locale ?? 'ar',
    onboardingState: { step: 'store', completedSteps: ['account'] },
  }).returning();
  return { tenant: tenant!, derived };
}

export async function register(input: RegisterInput, config: SessionSecrets): Promise<RegisterResult> {
  const db = unsafeAdminDb();
  const email = normaliseEmail(input.email);

  const limit = await rateLimiter().hit(`register:${input.ip ?? 'unknown'}`, LIMITS.register.limit, LIMITS.register.windowSeconds);
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfter);

  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    // Registration cannot be a membership oracle either: the caller is told to sign in,
    // which is true whether or not the address is already registered.
    throw errors.conflict('this email already has an account — sign in instead');
  }

  // T118: the slow, fallible work first — a failure here creates nothing — then the store, the person and the
  // membership together: before, a hash refused by the live runtime left a store with no owner on each try.
  const passwordHash = await hashPassword(input.password);
  const { tenant, derived, user } = await db.transaction(async (tx) => {
    const store = await createTrialStore(tx as unknown as typeof db, input.storeName, input.locale);
    const [person] = await tx.insert(users).values({
      id: uuidv7(),
      email,
      fullName: input.fullName,
      passwordHash,
      locale: input.locale ?? 'ar',
      phone: input.phone ? normalisePhone(input.phone) : null,
    }).returning();
    await tx.insert(tenantMemberships).values({
      id: uuidv7(), tenantId: store.tenant.id, userId: person!.id, role: 'owner', status: 'active',
    });
    return { ...store, user: person! };
  });

  const emailVerificationToken = await createVerificationToken({
    userId: user.id, purpose: 'email_verify', destination: email, ttlMinutes: 60 * 24, config,
  });

  const session = await issueSession({
    userId: user.id, tenantId: tenant.id, userAgent: input.userAgent, ip: input.ip, config,
  });

  log.info('tenant registered', { tenantId: tenant.id, userId: user.id, slug: tenant.slug });

  return { user, tenant, session, slugNeedsConfirmation: derived === null, emailVerificationToken };
}

/**
 * P6 (T30) — a signed-in person adds another store: its own 14-day trial, them as its owner, the
 * creation in the new store's activity. The address must be confirmed first, and a person can add
 * a handful a day, since every store starts a free trial.
 */
export async function addStore(userId: string, input: { storeName: string; locale?: 'ar' | 'en' }): Promise<{ tenant: Tenant; slugNeedsConfirmation: boolean }> {
  const db = unsafeAdminDb(); // like sign-up: the store does not exist yet, so there is no scope to enter
  const limit = await rateLimiter().hit(`add-store:${userId}`, LIMITS.addStore.limit, LIMITS.addStore.windowSeconds);
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfter);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user) throw errors.unauthenticated();
  if (!user.emailVerifiedAt) throw errors.forbidden('confirm your email address before adding another store');
  const { tenant, derived } = await createTrialStore(db, input.storeName, input.locale ?? (user.locale === 'en' ? 'en' : 'ar'));
  await db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: tenant.id, userId, role: 'owner', status: 'active' });
  await db.insert(auditLogs).values({
    id: uuidv7(), tenantId: tenant.id, actorUserId: userId, actorType: 'user', action: 'create', resourceType: 'tenant', resourceId: tenant.id,
    changes: { after: { name: tenant.name, slug: tenant.slug, status: tenant.status } },
  } as never);
  log.info('store added', { tenantId: tenant.id, userId, slug: tenant.slug });
  return { tenant, slugNeedsConfirmation: derived === null };
}

export type LoginInput = {
  email: string;
  password: string;
  userAgent?: string | null;
  ip?: string | null;
};

/** P1.2b: a correct password for an account with two-factor on — the code is still to come. */
export type TwoFactorPending = { twoFactorChallenge: string };

export async function login(input: LoginInput, config: SessionSecrets): Promise<IssuedSession | TwoFactorPending> {
  const db = unsafeAdminDb();
  const email = normaliseEmail(input.email);

  for (const key of [`login:email:${email}`, `login:ip:${input.ip ?? 'unknown'}`]) {
    const limit = await rateLimiter().hit(key, LIMITS.login.limit, LIMITS.login.windowSeconds);
    if (!limit.allowed) throw errors.rateLimited(limit.retryAfter);
  }

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1);

  // Identical failure for every cause. The `internal` field is for the log only.
  if (!user || user.deletedAt) throw errors.credentials('no such user');
  if (user.lockedUntil && user.lockedUntil.getTime() > Date.now()) {
    throw errors.credentials(`locked until ${user.lockedUntil.toISOString()}`);
  }

  if (!(await verifyPassword(input.password, user.passwordHash))) {
    await countFailedLogin(user.id, user.failedLoginCount);
    throw errors.credentials('wrong password');
  }

  // The hash was correct; upgrade it if the parameters have moved on since (T3).
  if (needsRehash(user.passwordHash)) {
    await db.update(users).set({ passwordHash: await hashPassword(input.password) }).where(eq(users.id, user.id));
  }

  // P1.2b: the failure count is *not* reset here when a code is still needed — otherwise
  // someone holding the password could re-enter it between guesses and never be locked out.
  if (user.totpEnabled) {
    const [fresh] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
    return { twoFactorChallenge: await twoFactorChallenge(user.id, fresh.passwordHash, config.authSecret) };
  }
  return completeLogin(user.id, input, config);
}

/** The last step of every sign-in: counters cleared, a session for the user's first store. */
export async function completeLogin(
  userId: string, input: { userAgent?: string | null; ip?: string | null }, config: SessionSecrets,
): Promise<IssuedSession> {
  const db = unsafeAdminDb();
  await db.update(users).set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() }).where(eq(users.id, userId));

  const [membership] = await db.select().from(tenantMemberships).where(and(
    eq(tenantMemberships.userId, userId),
    eq(tenantMemberships.status, 'active'),
  )).limit(1);

  return issueSession({
    userId,
    tenantId: membership?.tenantId ?? null,
    userAgent: input.userAgent,
    ip: input.ip,
    config,
  });
}

/** One failed sign-in step (password or code), counted toward the lockout. */
export async function countFailedLogin(userId: string, failedSoFar: number): Promise<void> {
  const failed = failedSoFar + 1;
  await unsafeAdminDb().update(users).set({
    failedLoginCount: failed,
    lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
  }).where(eq(users.id, userId));
}

// ------------------------------------------------------------ two-factor challenge (P1.2b)

const CHALLENGE_TTL_SECONDS = 5 * 60;

/**
 * Proof that the password step passed, for five minutes. Stateless: `user.exp.mac`, the MAC
 * covering the current password hash too — a password change voids every open challenge.
 */
export async function twoFactorChallenge(userId: string, passwordHash: string, authSecret: string, now = Date.now()): Promise<string> {
  const exp = Math.floor(now / 1000) + CHALLENGE_TTL_SECONDS;
  return `${userId}.${exp}.${await keyedHash(authSecret, 'mfa-challenge', `${userId}.${exp}.${passwordHash}`)}`;
}

/** The user a challenge was issued to, if it is genuine, unexpired and the password unchanged. */
export async function openTwoFactorChallenge(challenge: string, authSecret: string, now = Date.now()): Promise<User | null> {
  const [userId, expText, mac] = challenge.split('.');
  const exp = Number(expText);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId ?? '')) return null;
  if (!mac || !Number.isInteger(exp) || exp * 1000 <= now) return null;
  const [user] = await unsafeAdminDb().select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.deletedAt || !user.totpEnabled) return null;
  const expected = await keyedHash(authSecret, 'mfa-challenge', `${userId}.${exp}.${user.passwordHash}`);
  const enc = new TextEncoder();
  return timingSafeEqual(enc.encode(expected), enc.encode(mac)) ? user : null;
}

// ----------------------------------------------------------------- verification tokens

export async function createVerificationToken(input: {
  userId: string;
  purpose: 'email_verify' | 'password_reset' | 'phone_otp' | 'email_change';
  destination?: string;
  ttlMinutes: number;
  config: SessionSecrets;
}): Promise<string> {
  const db = unsafeAdminDb();
  // A six-digit OTP for phones, a long random token for links.
  const token = input.purpose === 'phone_otp' ? otpCode() : secret(32);

  await db.insert(verificationTokens).values({
    id: uuidv7(),
    userId: input.userId,
    purpose: input.purpose,
    tokenHash: await keyedHash(input.config.authSecret, input.purpose, token),
    destination: input.destination ?? null,
    expiresAt: new Date(Date.now() + input.ttlMinutes * 60_000),
  });

  return token;
}

/** Consume a token once. Expired, already used and wrong are the same answer. */
export async function consumeVerificationToken(input: {
  purpose: 'email_verify' | 'password_reset' | 'phone_otp' | 'email_change';
  token: string;
  config: SessionSecrets;
  now?: Date;
}): Promise<string | null> {
  const db = unsafeAdminDb();
  const now = input.now ?? new Date();
  const hash = await keyedHash(input.config.authSecret, input.purpose, input.token);

  const [row] = await db.select().from(verificationTokens).where(and(
    eq(verificationTokens.purpose, input.purpose),
    eq(verificationTokens.tokenHash, hash),
    isNull(verificationTokens.consumedAt),
  )).limit(1);

  if (!row || row.expiresAt.getTime() <= now.getTime()) return null;

  await db.update(verificationTokens)
    .set({ consumedAt: now })
    .where(eq(verificationTokens.id, row.id));

  return row.userId;
}

export async function verifyEmail(token: string, config: SessionSecrets): Promise<boolean> {
  const userId = await consumeVerificationToken({ purpose: 'email_verify', token, config });
  if (!userId) return false;
  const db = unsafeAdminDb();
  await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, userId));
  return true;
}

/**
 * P1.2 — a fresh verification link for a signed-in user whose first one expired or got lost.
 * Every older unused link stops working, so only the newest email in the inbox is live.
 * `null` when the address is already confirmed: nothing to send.
 */
export async function resendEmailVerification(
  userId: string, config: SessionSecrets,
): Promise<{ email: string; locale: 'ar' | 'en'; token: string } | null> {
  const limit = await rateLimiter().hit(`verify-resend:${userId}`, LIMITS.verifyResend.limit, LIMITS.verifyResend.windowSeconds);
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfter);

  const db = unsafeAdminDb();
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!user || user.deletedAt) throw errors.unauthenticated();
  if (user.emailVerifiedAt) return null;

  await db.update(verificationTokens).set({ consumedAt: new Date() }).where(and(
    eq(verificationTokens.userId, userId),
    eq(verificationTokens.purpose, 'email_verify'),
    isNull(verificationTokens.consumedAt),
  ));
  const token = await createVerificationToken({
    userId, purpose: 'email_verify', destination: user.email, ttlMinutes: 60 * 24, config,
  });
  return { email: user.email, locale: user.locale, token };
}

/**
 * Always reports success. Whether an address is registered is not something an unauthenticated
 * caller gets to learn, so the response is identical either way and only the email differs.
 */
export async function requestPasswordReset(email: string, config: SessionSecrets, ip?: string | null): Promise<string | null> {
  const db = unsafeAdminDb();
  const normalised = normaliseEmail(email);

  const limit = await rateLimiter().hit(`reset:${ip ?? normalised}`, LIMITS.passwordReset.limit, LIMITS.passwordReset.windowSeconds);
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfter);

  const [user] = await db.select().from(users).where(eq(users.email, normalised)).limit(1);
  if (!user || user.deletedAt) {
    log.info('password reset requested for an unknown address', {});
    return null;
  }
  return createVerificationToken({ userId: user.id, purpose: 'password_reset', destination: normalised, ttlMinutes: 60, config });
}

export async function resetPassword(input: { token: string; password: string; config: SessionSecrets }): Promise<boolean> {
  const userId = await consumeVerificationToken({ purpose: 'password_reset', token: input.token, config: input.config });
  if (!userId) return false;

  const db = unsafeAdminDb();
  await db.update(users).set({
    passwordHash: await hashPassword(input.password),
    failedLoginCount: 0,
    lockedUntil: null,
  }).where(eq(users.id, userId));

  // Changing the password ends every session, including the attacker's.
  await revokeFamily(userId, 'password_change');
  return true;
}

// ------------------------------------------------------------------------- utilities

export function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * Saudi mobile numbers, stored as `+9665XXXXXXXX`. Arabic-Indic digits are folded first —
 * a Saudi keyboard produces U+0660 digits and every naive parse returns NaN (§13.6).
 */
export function normalisePhone(phone: string): string {
  let digits = foldDigits(phone).replace(/[^\d+]/g, '');
  // `00` is the international prefix most Saudis type: 00966 5X… is +966 5X….
  if (digits.startsWith('00')) digits = `+${digits.slice(2)}`;
  if (digits.startsWith('+966')) return digits;
  if (digits.startsWith('966')) return `+${digits}`;
  if (digits.startsWith('05')) return `+966${digits.slice(1)}`;
  if (digits.startsWith('5')) return `+966${digits}`;
  return digits;
}

/** Moved to `lib/safe-next.ts` so the sign-in screen can use the same check. */
export { safeNext } from '@/lib/safe-next';
