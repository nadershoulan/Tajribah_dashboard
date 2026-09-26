import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { sessions, users } from '@/db/schema';
import { createTestDb } from '@/server/testing/harness';
import {
  login, normalisePhone, register, requestPasswordReset, resetPassword, safeNext, verifyEmail,
} from '@/server/modules/auth/service';
import { rotateSession, revokeSession } from '@/server/core/auth/session';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';

const config = { authSecret: 'test-secret-at-least-32-characters!!', accessTtlMinutes: 15, refreshTtlDays: 30 };

function fresh() { setRateLimiter(new MemoryRateLimiter()); }

const account = {
  email: 'Owner@Failet.sa', password: 'a-long-enough-password', fullName: 'نادر',
  storeName: 'Failet Watches',
};

test('registration creates the user, the store and the owner membership', async () => {
  fresh();
  const harness = await createTestDb();
  const db = harness.db;
  try {
    const result = await register(account, config);
    assert.equal(result.user.email, 'owner@failet.sa', 'email is normalised');
    assert.equal(result.tenant.slug, 'failet-watches');
    assert.equal(result.tenant.status, 'trial');
    assert.ok(result.tenant.trialEndsAt!.getTime() > Date.now());
    assert.equal(result.slugNeedsConfirmation, false);
    assert.ok(result.session.accessToken.split('.').length === 3);
    assert.ok(result.session.refreshToken.length > 20);

    const stored = (await db.select().from(users))[0];
    assert.notEqual(stored.passwordHash, account.password, 'the password must never be stored');
    assert.match(stored.passwordHash, /^pbkdf2\$/);
  } finally { await harness.close(); }
});

test('an Arabic store name asks for slug confirmation instead of guessing', async () => {
  fresh();
  const harness = await createTestDb();
  try {
    const result = await register({ ...account, storeName: 'مجوهرات النور' }, config);
    assert.equal(result.slugNeedsConfirmation, true,
      'a transliterated Arabic slug must be confirmed by the merchant, never applied silently');
    assert.match(result.tenant.slug, /^store-[a-z0-9]+$/);
  } finally { await harness.close(); }
});

test('two stores with the same name get distinct slugs', async () => {
  fresh();
  const harness = await createTestDb();
  try {
    const first = await register(account, config);
    const second = await register({ ...account, email: 'second@failet.sa' }, config);
    assert.notEqual(second.tenant.slug, first.tenant.slug);
    assert.equal(second.tenant.slug, 'failet-watches-2');
  } finally { await harness.close(); }
});

test('registering a known address does not confirm it exists by failing differently', async () => {
  fresh();
  const harness = await createTestDb();
  try {
    await register(account, config);
    await assert.rejects(() => register(account, config), (error: { code?: string }) => {
      assert.equal(error.code, 'conflict');
      return true;
    });
  } finally { await harness.close(); }
});

test('login succeeds, and every failure looks the same', async () => {
  fresh();
  const harness = await createTestDb();
  try {
    await register(account, config);

    const session = await login({ email: account.email, password: account.password }, config);
    assert.ok('accessToken' in session && session.accessToken, 'no two-step sign-in on this account: a session at once');

    const shapes: string[] = [];
    for (const attempt of [
      { email: account.email, password: 'wrong-password' },
      { email: 'nobody@example.test', password: account.password },
    ]) {
      try { await login(attempt, config); assert.fail('should not authenticate'); }
      catch (error) {
        const e = error as { code: string; status: number; message: string };
        shapes.push(`${e.code}|${e.status}|${e.message}`);
      }
    }
    assert.equal(shapes[0], shapes[1], 'wrong password and unknown user must be indistinguishable');
  } finally { await harness.close(); }
});

test('repeated failures lock the account', async () => {
  fresh();
  const harness = await createTestDb();
  const db = harness.db;
  try {
    await register(account, config);
    for (let i = 0; i < 10; i++) {
      await login({ email: account.email, password: 'nope' }, config).catch(() => {});
    }
    const stored = (await db.select().from(users))[0];
    assert.ok(stored.lockedUntil && stored.lockedUntil.getTime() > Date.now(), 'account should be locked');

    // And the right password is refused while locked — with the same message as always.
    // The limiter is reset first so this asserts the lockout, not the rate limit; both
    // fire here, and a test that cannot tell them apart proves neither.
    fresh();
    await assert.rejects(() => login({ email: account.email, password: account.password }, config),
      (e: { code?: string }) => e.code === 'invalid_credentials');
  } finally { await harness.close(); }
});

test('rate limiting stops a credential-stuffing run', async () => {
  fresh();
  const harness = await createTestDb();
  try {
    await register(account, config);
    const codes: string[] = [];
    for (let i = 0; i < 14; i++) {
      await login({ email: account.email, password: `guess-${i}`, ip: '1.2.3.4' }, config)
        .catch((e: { code: string }) => codes.push(e.code));
    }
    assert.ok(codes.includes('rate_limited'), 'the limiter must engage before the attempts run out');
  } finally { await harness.close(); }
});

test('refresh rotates the token, and replaying the old one kills the family', async () => {
  fresh();
  const harness = await createTestDb();
  const db = harness.db;
  try {
    const registered = await register(account, config);
    const first = registered.session.refreshToken;

    const rotated = await rotateSession({ refreshToken: first, config });
    assert.equal(rotated.ok, true);
    const second = rotated.ok ? rotated.issued.refreshToken : '';
    assert.notEqual(second, first, 'the token must change');

    // The new one still works...
    assert.equal((await rotateSession({ refreshToken: second, config })).ok, true);

    // ...and the first one, replayed, is treated as theft.
    const replay = await rotateSession({ refreshToken: first, config });
    assert.deepEqual(replay, { ok: false, reason: 'reuse' });

    const live = (await db.select().from(sessions)).filter((s) => !s.revokedAt);
    assert.equal(live.length, 0, 'every session in the family must be revoked');
  } finally { await harness.close(); }
});

test('an unknown or revoked refresh token is refused', async () => {
  fresh();
  const harness = await createTestDb();
  try {
    const registered = await register(account, config);
    assert.deepEqual(await rotateSession({ refreshToken: 'not-a-real-token', config }),
      { ok: false, reason: 'unknown' });

    await revokeSession(registered.session.session.id);
    assert.deepEqual(await rotateSession({ refreshToken: registered.session.refreshToken, config }),
      { ok: false, reason: 'revoked' });
  } finally { await harness.close(); }
});

test('password reset works once, and ends every session', async () => {
  fresh();
  const harness = await createTestDb();
  const db = harness.db;
  try {
    await register(account, config);
    await login({ email: account.email, password: account.password }, config);

    const token = await requestPasswordReset(account.email, config);
    assert.ok(token);

    assert.equal(await resetPassword({ token: token!, password: 'a-brand-new-password', config }), true);
    assert.equal(await resetPassword({ token: token!, password: 'again', config }), false,
      'a reset token is single use');

    const live = (await db.select().from(sessions)).filter((s) => !s.revokedAt);
    assert.equal(live.length, 0, 'a password change must revoke every session');

    await assert.rejects(() => login({ email: account.email, password: account.password }, config));
    assert.ok(await login({ email: account.email, password: 'a-brand-new-password' }, config));
  } finally { await harness.close(); }
});

test('a reset request for an unknown address reveals nothing', async () => {
  fresh();
  const harness = await createTestDb();
  try {
    assert.equal(await requestPasswordReset('nobody@example.test', config), null);
  } finally { await harness.close(); }
});

test('email verification is single use', async () => {
  fresh();
  const harness = await createTestDb();
  const db = harness.db;
  try {
    const registered = await register(account, config);
    assert.equal(await verifyEmail(registered.emailVerificationToken, config), true);
    assert.equal(await verifyEmail(registered.emailVerificationToken, config), false);

    const stored = (await db.select().from(users).where(eq(users.id, registered.user.id)))[0];
    assert.ok(stored.emailVerifiedAt);
  } finally { await harness.close(); }
});

test('Saudi phone numbers normalise, including Arabic-Indic digits', () => {
  assert.equal(normalisePhone('0512345678'), '+966512345678');
  assert.equal(normalisePhone('+966 51 234 5678'), '+966512345678');
  assert.equal(normalisePhone('966512345678'), '+966512345678');
  assert.equal(normalisePhone('٠٥١٢٣٤٥٦٧٨'), '+966512345678');
  assert.equal(normalisePhone('۰۵۱۲۳۴۵۶۷۸'), '+966512345678');
});

test('?next= cannot leave the dashboard', () => {
  assert.equal(safeNext('/dashboard/products'), '/dashboard/products');
  assert.equal(safeNext('//evil.example'), '/dashboard');
  assert.equal(safeNext('https://evil.example'), '/dashboard');
  assert.equal(safeNext('/\\evil.example'), '/dashboard');
  assert.equal(safeNext('/api/auth/logout'), '/dashboard');
  assert.equal(safeNext(null), '/dashboard');
  assert.equal(safeNext('/\t/evil.example'), '/dashboard', 'browsers drop the tab and follow //evil.example');
  assert.equal(safeNext('/\n/evil.example'), '/dashboard');
});
