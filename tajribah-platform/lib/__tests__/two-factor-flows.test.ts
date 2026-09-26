/**
 * P1.2b — two-step sign-in end to end: the real `ApiClient`, the real handlers, PGlite.
 * Codes are computed with the RFC 6238 code the authenticator app runs, one fresh time step
 * per use (a step is accepted once), always inside the ±1 window.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { ApiClient, ApiError } from '@/lib/api-client';
import { users } from '@/db/schema';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { configureNotify } from '@/server/core/notify/notify';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { setLogLevel } from '@/server/core/observability/log';
import { stepAt, totpCode } from '@/server/core/auth/totp';
import { createTestDb, type TestDb } from '@/server/testing/harness';
import * as auth from '@/server/modules/auth/http';
import { openTwoFactorChallenge, twoFactorChallenge } from '@/server/modules/auth/service';
import { resealTwoFactorSecrets } from '@/server/modules/auth/two-factor';

const APP = 'http://localhost:5173';
const KEY_A = 'a'.repeat(40);
const KEY_B = 'b'.repeat(40);
const HANDLERS: Record<string, (r: Request) => Promise<Response>> = {
  '/api/auth/register': auth.registerHandler,
  '/api/auth/login': auth.loginHandler,
  '/api/auth/login/2fa': auth.loginTwoFactorHandler,
  '/api/auth/refresh': auth.refreshHandler,
  '/api/auth/logout': auth.logoutHandler,
  '/api/auth/me': auth.meHandler,
  '/api/auth/2fa': auth.twoFactorStatusHandler,
  '/api/auth/2fa/setup': auth.twoFactorSetupHandler,
  '/api/auth/2fa/enable': auth.twoFactorEnableHandler,
  '/api/auth/2fa/disable': auth.twoFactorDisableHandler,
  '/api/auth/2fa/backup-codes': auth.twoFactorBackupCodesHandler,
};

function browser(origin = APP) {
  const jar = new Map<string, string>();
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, APP);
    const headers = new Headers(init.headers);
    headers.set('origin', origin);
    if (jar.size && url.pathname.startsWith('/api/auth')) headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    const handler = HANDLERS[url.pathname];
    if (!handler) return new Response(null, { status: 404 });
    const response = await handler(new Request(url, { ...init, headers }));
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const [name, value] = setCookie.split(';')[0].split('=');
      if (/Max-Age=0/.test(setCookie) || !value) jar.delete(name); else jar.set(name, value);
    }
    return response;
  }) as typeof fetch;
  return { fetchImpl, jar };
}

function setup(keys: { current: string; previous?: string } = { current: KEY_A }) {
  resetEnv();
  loadEnv({
    APP_URL: APP, AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: keys.current,
    ...(keys.previous ? { ENCRYPTION_KEY_PREVIOUS: keys.previous } : {}),
  });
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
  setRateLimiter(new MemoryRateLimiter());
  setLogLevel('error');
}

async function mailed<T>(fn: () => Promise<T>): Promise<{ value: T; mail: string }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { return { value: await fn(), mail: lines.join('\n') }; } finally { console.log = original; }
}

const is = (status: number, code?: string, field?: string) => (e: unknown) =>
  e instanceof ApiError && e.status === status && (!code || e.code === code) && (!field || !!e.fields?.[field]);

const ACCOUNT = { email: 'owner@example.test', password: 'a-long-enough-password', fullName: 'نادر', storeName: 'Oud House' };

/** The phone: hands out the code for the next unused step, starting one step back. */
function phone(secret: string) {
  let last: number | null = null;
  return {
    async next(): Promise<string> {
      const step = last === null ? stepAt() - 1 : Math.max(last + 1, stepAt() - 1);
      assert.ok(step <= stepAt() + 1, 'the test ran out of time steps');
      last = step;
      return totpCode(secret, step);
    },
    /** The code for a step already used — what someone who watched the screen would type. */
    replay: () => totpCode(secret, last!),
  };
}

async function signedUpWithTwoFactor(harness: TestDb) {
  void harness;
  const tab = browser();
  const client = new ApiClient(tab.fetchImpl);
  await mailed(() => client.register(ACCOUNT));
  const { secret } = await client.startTwoFactorSetup(ACCOUNT.password);
  const app = phone(secret);
  const { value, mail } = await mailed(async () => client.enableTwoFactor(await app.next()));
  await client.logout();
  return { client, tab, app, secret, backupCodes: value.backupCodes, mail };
}

test('setup: password again, then the first code; backup codes once; the owner is emailed', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const client = new ApiClient(browser().fetchImpl);
    await mailed(() => client.register(ACCOUNT));
    assert.deepEqual(await client.twoFactorStatus(), { enabled: false, backupCodesLeft: 0 });

    await assert.rejects(() => client.startTwoFactorSetup('wrong-password'), is(422, 'validation_failed', 'password'));
    await assert.rejects(() => client.enableTwoFactor('123456'), is(409), 'no setup started');

    const { secret, otpauthUrl } = await client.startTwoFactorSetup(ACCOUNT.password);
    assert.match(otpauthUrl, /^otpauth:\/\/totp\/Tajribah%3Aowner%40example\.test\?secret=/);
    const stored = await harness.asAdmin(() => harness.db.select().from(users).where(eq(users.email, ACCOUNT.email)));
    assert.ok(stored[0].totpSecretEncrypted?.startsWith('v2.') && !stored[0].totpSecretEncrypted.includes(secret), 'sealed, never stored in the clear');

    const app = phone(secret);
    await assert.rejects(() => client.enableTwoFactor('000000'), is(422, 'validation_failed', 'code'));
    assert.deepEqual(await client.twoFactorStatus(), { enabled: false, backupCodesLeft: 0 }, 'a wrong first code turns nothing on');

    const { value, mail } = await mailed(async () => client.enableTwoFactor(await app.next()));
    assert.equal(value.backupCodes.length, 10);
    assert.match(mail, /email to owner@example\.test/);
    assert.match(mail, /تم تفعيل التحقق بخطوتين/, 'in the account’s language');
    assert.deepEqual(await client.twoFactorStatus(), { enabled: true, backupCodesLeft: 10 });
    const hashes = (await harness.asAdmin(() => harness.db.select().from(users)))[0].backupCodesHash!;
    assert.ok(value.backupCodes.every((code) => !hashes.some((h) => h.includes(code.replace('-', '')))), 'only hashes are stored');

    await assert.rejects(() => client.startTwoFactorSetup(ACCOUNT.password), is(409), 'already on: a new setup cannot replace the secret');
  } finally { await harness.close(); resetEnv(); }
});

test('sign-in: the password alone signs nobody in; the code does, once', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { client, tab, app } = await signedUpWithTwoFactor(harness);

    const pending = await client.login(ACCOUNT.email, ACCOUNT.password);
    assert.ok(pending?.twoFactorChallenge, 'a challenge instead of a session');
    assert.equal(client.signedIn, false);
    assert.equal(tab.jar.size, 0, 'no refresh cookie before the code');

    await assert.rejects(async () => client.completeTwoFactor(pending!.twoFactorChallenge, await app.replay()), is(401, 'invalid_credentials'),
      'the code used to turn it on cannot be used again');
    await assert.rejects(() => client.completeTwoFactor(`${pending!.twoFactorChallenge}x`, '123456'), is(401, 'unauthenticated'),
      'a tampered challenge is "sign in again"');

    // Typed on a Saudi keyboard: Arabic-Indic digits reach the authenticator check, not the backup codes.
    const arabic = (await app.next()).replace(/[0-9]/g, (d) => String.fromCharCode(0x0660 + Number(d)));
    await client.completeTwoFactor(pending!.twoFactorChallenge, arabic);
    assert.equal(client.signedIn, true);
    assert.ok(tab.jar.has('tajribah_rt'));
    assert.equal((await client.me()).user.email, ACCOUNT.email);

    const replay = await client.login(ACCOUNT.email, ACCOUNT.password);
    await assert.rejects(async () => client.completeTwoFactor(replay!.twoFactorChallenge, await app.replay()), is(401, 'invalid_credentials'),
      'a code seen over a shoulder does not work a second time');
  } finally { await harness.close(); resetEnv(); }
});

test('backup codes: each signs in once; new ones replace the old', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { client, backupCodes } = await signedUpWithTwoFactor(harness);
    const first = await client.login(ACCOUNT.email, ACCOUNT.password);
    await client.completeTwoFactor(first!.twoFactorChallenge, backupCodes[0].toUpperCase().replace('-', ' '));
    assert.deepEqual(await client.twoFactorStatus(), { enabled: true, backupCodesLeft: 9 });
    await client.logout();

    const second = await client.login(ACCOUNT.email, ACCOUNT.password);
    await assert.rejects(() => client.completeTwoFactor(second!.twoFactorChallenge, backupCodes[0]), is(401, 'invalid_credentials'), 'used once');
    await client.completeTwoFactor(second!.twoFactorChallenge, backupCodes[1]);

    await assert.rejects(() => client.regenerateBackupCodes('wrong-password'), is(422, 'validation_failed', 'password'));
    const { backupCodes: fresh } = await client.regenerateBackupCodes(ACCOUNT.password);
    await client.logout();
    const third = await client.login(ACCOUNT.email, ACCOUNT.password);
    await assert.rejects(() => client.completeTwoFactor(third!.twoFactorChallenge, backupCodes[2]), is(401), 'the old set stopped working');
    await client.completeTwoFactor(third!.twoFactorChallenge, fresh[0]);
  } finally { await harness.close(); resetEnv(); }
});

test('wrong codes lock the account like wrong passwords — re-entering the password does not reset the count', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { client, app } = await signedUpWithTwoFactor(harness);
    // The per-user code rate limit (in memory, per isolate) also counts the setup code; start
    // it afresh so this test sees the lockout, which is the durable rule, in the database.
    setRateLimiter(new MemoryRateLimiter());
    let pending = await client.login(ACCOUNT.email, ACCOUNT.password);
    for (let i = 0; i < 9; i++) {
      if (i === 5) pending = await client.login(ACCOUNT.email, ACCOUNT.password); // the password again, halfway
      await assert.rejects(() => client.completeTwoFactor(pending!.twoFactorChallenge, '000000'), is(401, 'invalid_credentials'));
    }
    const row = async () => (await harness.asAdmin(() => harness.db.select().from(users)))[0];
    assert.equal((await row()).failedLoginCount, 9, 'the password step did not clear the count');
    await assert.rejects(() => client.completeTwoFactor(pending!.twoFactorChallenge, '000000'), is(401));
    assert.ok((await row()).lockedUntil, 'the tenth wrong code locks the account');
    await assert.rejects(async () => client.completeTwoFactor(pending!.twoFactorChallenge, await app.next()), is(401, 'invalid_credentials'), 'locked: even the right code');
    await assert.rejects(() => client.login(ACCOUNT.email, ACCOUNT.password), is(401), 'and the password step too');
  } finally { await harness.close(); resetEnv(); }
});

test('a challenge lasts five minutes and dies with a password change', async () => {
  setup();
  const harness = await createTestDb();
  try {
    await signedUpWithTwoFactor(harness);
    const [user] = await harness.asAdmin(() => harness.db.select().from(users));
    const secret = 's'.repeat(40);
    const challenge = await twoFactorChallenge(user.id, user.passwordHash, secret);
    assert.equal((await openTwoFactorChallenge(challenge, secret))?.id, user.id);
    assert.equal(await openTwoFactorChallenge(challenge, secret, Date.now() + 5 * 60_000 + 1000), null, 'expired');
    assert.equal(await openTwoFactorChallenge(challenge, 'another-secret-another-secret-another'), null, 'forged');
    assert.equal(await openTwoFactorChallenge(`not-a-uuid.${challenge.split('.').slice(1).join('.')}`, secret), null);
    await harness.asAdmin(() => harness.db.update(users).set({ passwordHash: 'pbkdf2$changed' }).where(eq(users.id, user.id)));
    assert.equal(await openTwoFactorChallenge(challenge, secret), null, 'a password change voids it');
  } finally { await harness.close(); resetEnv(); }
});

test('turning it off needs the password and a code; then the password alone signs in', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { client, app } = await signedUpWithTwoFactor(harness);
    const pending = await client.login(ACCOUNT.email, ACCOUNT.password);
    await client.completeTwoFactor(pending!.twoFactorChallenge, await app.next());

    await assert.rejects(() => client.disableTwoFactor('wrong-password', '123456'), is(422, 'validation_failed', 'password'));
    await assert.rejects(() => client.disableTwoFactor(ACCOUNT.password, '000000'), is(422, 'validation_failed', 'code'));
    const { mail } = await mailed(async () => client.disableTwoFactor(ACCOUNT.password, await app.next()));
    assert.match(mail, /تم إيقاف التحقق بخطوتين/);
    assert.deepEqual(await client.twoFactorStatus(), { enabled: false, backupCodesLeft: 0 });
    const [row] = await harness.asAdmin(() => harness.db.select().from(users));
    assert.deepEqual([row.totpSecretEncrypted, row.backupCodesHash, row.totpLastStep], [null, null, null], 'nothing left behind');

    await client.logout();
    assert.equal(await client.login(ACCOUNT.email, ACCOUNT.password), null, 'a session straight away');
    assert.equal(client.signedIn, true);
  } finally { await harness.close(); resetEnv(); }
});

test('cross-site requests to the two-step endpoints are refused', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const client = new ApiClient(browser().fetchImpl);
    await mailed(() => client.register(ACCOUNT));
    const token = (client as unknown as { accessToken: string }).accessToken;
    for (const [handler, path, body] of [
      [auth.twoFactorSetupHandler, '/api/auth/2fa/setup', { password: ACCOUNT.password }],
      [auth.twoFactorEnableHandler, '/api/auth/2fa/enable', { code: '123456' }],
      [auth.twoFactorDisableHandler, '/api/auth/2fa/disable', { password: ACCOUNT.password, code: '123456' }],
      [auth.twoFactorBackupCodesHandler, '/api/auth/2fa/backup-codes', { password: ACCOUNT.password }],
      [auth.loginTwoFactorHandler, '/api/auth/login/2fa', { challenge: 'x'.repeat(20), code: '123456' }],
    ] as const) {
      const response = await handler(new Request(`${APP}${path}`, {
        method: 'POST', body: JSON.stringify(body),
        headers: { origin: 'https://evil.example', 'content-type': 'application/json', authorization: `Bearer ${token}` },
      }));
      assert.equal(response.status, 403, path);
    }
  } finally { await harness.close(); resetEnv(); }
});

test('key rotation: the sweep moves authenticator secrets to the new key, so removing the old one locks nobody out', async () => {
  setup({ current: KEY_A });
  const harness = await createTestDb();
  try {
    const { client, app } = await signedUpWithTwoFactor(harness);

    setup({ current: KEY_B, previous: KEY_A });
    assert.deepEqual(await resealTwoFactorSecrets(), { resealed: 1, unreadable: 0 });
    assert.deepEqual(await resealTwoFactorSecrets(), { resealed: 0, unreadable: 0 }, 'nothing left on the next tick');

    setup({ current: KEY_B }); // the old key removed
    const pending = await client.login(ACCOUNT.email, ACCOUNT.password);
    await client.completeTwoFactor(pending!.twoFactorChallenge, await app.next());
    assert.equal(client.signedIn, true);
  } finally { await harness.close(); resetEnv(); }
});

test('a sealed secret is bound to its account: copied onto another user it does not open', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { app } = await signedUpWithTwoFactor(harness);
    const other = new ApiClient(browser().fetchImpl);
    await mailed(() => other.register({ ...ACCOUNT, email: 'other@example.test' }));
    const { secret: otherSecret } = await other.startTwoFactorSetup(ACCOUNT.password);
    await mailed(async () => other.enableTwoFactor(await phone(otherSecret).next()));
    await other.logout();

    // Someone with database write access copies the owner's sealed secret onto their own row.
    const [owner] = await harness.asAdmin(() => harness.db.select().from(users).where(eq(users.email, ACCOUNT.email)));
    await harness.asAdmin(() => harness.db.update(users).set({ totpSecretEncrypted: owner.totpSecretEncrypted, totpLastStep: null })
      .where(eq(users.email, 'other@example.test')));
    const pending = await other.login('other@example.test', ACCOUNT.password);
    await assert.rejects(async () => other.completeTwoFactor(pending!.twoFactorChallenge, await app.next()), is(401, 'invalid_credentials'));
  } finally { await harness.close(); resetEnv(); }
});
