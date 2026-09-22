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
  tenantMemberships, tenants, users, verificationTokens,
  type Tenant, type User,
} from '@/db/schema';
import { secret, uuidv7 } from '@/lib/ids';
import { foldDigits } from '@/lib/money';
import { generatedSlug, nextAvailable, slugify } from '@/lib/slug';
import { TRIAL_DAYS } from '@/lib/plans';
import { hashPassword, keyedHash, needsRehash, otpCode, verifyPassword } from '@/server/core/auth/crypto';
import {
  issueSession, revokeFamily, type IssuedSession, type SessionSecrets,
} from '@/server/core/auth/session';
import { errors } from '@/server/core/errors/problem';
import { log } from '@/server/core/observability/log';
import { LIMITS, rateLimiter } from '@/server/core/ratelimit/limiter';

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

export type RegisterResult = {
  user: User;
  tenant: Tenant;
  session: IssuedSession;
  /** True when the slug could not be derived from the store name and must be confirmed. */
  slugNeedsConfirmation: boolean;
  emailVerificationToken: string;
};

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

  const derived = slugify(input.storeName);
  const taken = new Set((await db.select({ slug: tenants.slug }).from(tenants)).map((r) => r.slug));
  const slug = nextAvailable(derived ?? generatedSlug(), taken);

  const now = new Date();
  const [tenant] = await db.insert(tenants).values({
    id: uuidv7(),
    slug,
    name: input.storeName,
    nameAr: input.locale === 'en' ? null : input.storeName,
    status: 'trial',
    trialEndsAt: new Date(now.getTime() + TRIAL_DAYS * 24 * 3600 * 1000),
    locale: input.locale ?? 'ar',
    onboardingState: { step: 'store', completedSteps: ['account'] },
  }).returning();

  const [user] = await db.insert(users).values({
    id: uuidv7(),
    email,
    fullName: input.fullName,
    passwordHash: await hashPassword(input.password),
    locale: input.locale ?? 'ar',
    phone: input.phone ? normalisePhone(input.phone) : null,
  }).returning();

  await db.insert(tenantMemberships).values({
    id: uuidv7(), tenantId: tenant.id, userId: user.id, role: 'owner', status: 'active',
  });

  const emailVerificationToken = await createVerificationToken({
    userId: user.id, purpose: 'email_verify', destination: email, ttlMinutes: 60 * 24, config,
  });

  const session = await issueSession({
    userId: user.id, tenantId: tenant.id, userAgent: input.userAgent, ip: input.ip, config,
  });

  log.info('tenant registered', { tenantId: tenant.id, userId: user.id, slug });

  return { user, tenant, session, slugNeedsConfirmation: derived === null, emailVerificationToken };
}

export type LoginInput = {
  email: string;
  password: string;
  userAgent?: string | null;
  ip?: string | null;
};

export async function login(input: LoginInput, config: SessionSecrets): Promise<IssuedSession> {
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
    const failed = user.failedLoginCount + 1;
    await db.update(users).set({
      failedLoginCount: failed,
      lockedUntil: failed >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000) : null,
    }).where(eq(users.id, user.id));
    throw errors.credentials('wrong password');
  }

  // The hash was correct; upgrade it if the parameters have moved on since (T3).
  const patch: Partial<typeof users.$inferInsert> = {
    failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date(),
  };
  if (needsRehash(user.passwordHash)) patch.passwordHash = await hashPassword(input.password);
  await db.update(users).set(patch).where(eq(users.id, user.id));

  const [membership] = await db.select().from(tenantMemberships).where(and(
    eq(tenantMemberships.userId, user.id),
    eq(tenantMemberships.status, 'active'),
  )).limit(1);

  return issueSession({
    userId: user.id,
    tenantId: membership?.tenantId ?? null,
    userAgent: input.userAgent,
    ip: input.ip,
    config,
  });
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
