/**
 * P1.2 — the flows behind the new screens, end to end: the real `ApiClient` and `apiSource`,
 * the real handlers, a real Postgres (PGlite). The browser is the only stand-in: fetch is
 * routed to the handler for the path, with a cookie jar, as in api-client.test.ts.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ApiClient, ApiError } from '@/lib/api-client';
import { apiSource } from '@/lib/data';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { configureNotify } from '@/server/core/notify/notify';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb } from '@/server/testing/harness';
import * as auth from '@/server/modules/auth/http';
import * as onboarding from '@/server/modules/onboarding/http';
import * as dashboard from '@/server/modules/dashboard/http';

const APP = 'http://localhost:5173';
const HANDLERS: Record<string, (r: Request) => Promise<Response>> = {
  '/api/auth/register': auth.registerHandler,
  '/api/auth/login': auth.loginHandler,
  '/api/auth/refresh': auth.refreshHandler,
  '/api/auth/logout': auth.logoutHandler,
  '/api/auth/me': auth.meHandler,
  '/api/auth/verify-email': auth.verifyEmailHandler,
  '/api/auth/verify-email/resend': auth.resendVerificationHandler,
  '/api/auth/password-reset': auth.requestResetHandler,
  '/api/auth/password-reset/confirm': auth.confirmResetHandler,
  '/api/onboarding': onboarding.getOnboardingHandler,
  '/api/onboarding/skip': onboarding.skipStepHandler,
  '/api/onboarding/unskip': onboarding.unskipStepHandler,
  '/api/onboarding/confirm-store': onboarding.confirmStoreHandler,
  '/api/dashboard': dashboard.dashboardHandler,
};

function browser() {
  const jar = new Map<string, string>();
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, APP);
    const headers = new Headers(init.headers);
    headers.set('origin', APP);
    headers.set('sec-fetch-site', 'same-origin');
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

function setup() {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
  setRateLimiter(new MemoryRateLimiter());
  setLogLevel('error');
}

/** Run `fn`, returning what it resolved to and everything the console email adapter printed. */
async function mailed<T>(fn: () => Promise<T>): Promise<{ value: T; mail: string }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { return { value: await fn(), mail: lines.join('\n') }; } finally { console.log = original; }
}

const linkToken = (mail: string, path: string) => decodeURIComponent(new RegExp(`${path}\\?token=([^\\s]+)`).exec(mail)![1]);
const rejectsWith = (status: number, field?: string) => (e: unknown) =>
  e instanceof ApiError && e.status === status && (!field || !!e.fields?.[field]);

const ACCOUNT = { email: 'owner@example.test', password: 'a-long-enough-password', fullName: 'نادر', storeName: 'مجوهرات النور' };

test('verify email: a resend replaces the old link; the new one confirms the address; then there is nothing to resend', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const client = new ApiClient(browser().fetchImpl);
    const signup = await mailed(() => client.register(ACCOUNT));
    const first = linkToken(signup.mail, 'verify-email');

    const resent = await mailed(() => client.resendVerification());
    assert.deepEqual(resent.value, { sent: true, alreadyVerified: false });
    assert.match(resent.mail, /owner@example\.test/);
    assert.match(resent.mail, /أكّد بريدك/, 'the resend goes out in the account’s language (Arabic)');
    const second = linkToken(resent.mail, 'verify-email');
    assert.notEqual(second, first);

    await assert.rejects(() => client.verifyEmail(first), rejectsWith(422, 'token'), 'the replaced link still worked');
    assert.equal((await client.me()).user.emailVerified, false);

    // Opened in another browser with no session: the link alone is enough.
    await new ApiClient(browser().fetchImpl).verifyEmail(second);
    assert.equal((await client.me()).user.emailVerified, true);

    const again = await mailed(() => client.resendVerification());
    assert.deepEqual(again.value, { sent: false, alreadyVerified: true });
    assert.equal(again.mail, '', 'no email for an address that is already confirmed');

    await assert.rejects(() => new ApiClient(browser().fetchImpl).resendVerification(), rejectsWith(401), 'resend needs a session');
  } finally { await harness.close(); resetEnv(); }
});

test('reset password: the emailed link sets a new password and signs this browser out too', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const tab = browser();
    const client = new ApiClient(tab.fetchImpl);
    await mailed(() => client.register(ACCOUNT));

    const asked = await mailed(() => client.requestPasswordReset(ACCOUNT.email, 'en'));
    assert.match(asked.mail, /Reset your/, 'the email is in the language the screen asked for');
    const token = linkToken(asked.mail, 'reset-password');

    await assert.rejects(() => client.confirmPasswordReset(token, 'short'), rejectsWith(422, 'password'));
    await client.confirmPasswordReset(token, 'a-brand-new-password');
    assert.equal(client.signedIn, false, 'this tab dropped its access token');
    assert.equal(tab.jar.size, 0, 'the refresh cookie was cleared');
    assert.equal(await client.restore(), false, 'nothing to restore after a reset');

    await assert.rejects(() => client.confirmPasswordReset(token, 'yet-another-password'), rejectsWith(422, 'token'), 'a link works once');
    await assert.rejects(() => client.login(ACCOUNT.email, ACCOUNT.password), rejectsWith(401));
    await client.login(ACCOUNT.email, 'a-brand-new-password');
    assert.equal(client.signedIn, true);
  } finally { await harness.close(); resetEnv(); }
});

test('setup guide through the API: the store address is chosen once, then fixed; plan and connect can be put off', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const client = new ApiClient(browser().fetchImpl);
    await mailed(() => client.register(ACCOUNT));
    const source = apiSource(client);
    const generated = (await client.me()).tenants[0].slug;
    assert.match(generated, /^store-/, 'an Arabic name gets a generated address, shown to the merchant');
    assert.equal((await source.onboarding()).current, 'store');

    // Another merchant already holds "oud-house".
    await mailed(() => new ApiClient(browser().fetchImpl).register({ ...ACCOUNT, email: 'other@example.test', storeName: 'Oud House' }));

    await assert.rejects(() => source.confirmStore('Not A Slug'), rejectsWith(422, 'slug'));
    await assert.rejects(() => source.confirmStore('admin'), rejectsWith(422, 'slug'), 'a reserved address');
    await assert.rejects(() => source.confirmStore('oud-house'), rejectsWith(422, 'slug'), 'another store’s address');
    assert.equal((await client.me()).tenants[0].slug, generated, 'a refused confirm changes nothing');
    assert.equal((await source.onboarding()).current, 'store');

    const confirmed = await source.confirmStore('al-nour');
    assert.equal(confirmed.current, 'plan');
    assert.equal((await client.me()).tenants[0].slug, 'al-nour');
    await assert.rejects(() => source.confirmStore('al-nour-2'), rejectsWith(422, 'slug'), 'the address is fixed once confirmed');
    assert.equal((await source.confirmStore()).current, 'plan', 'confirming again without an address is harmless');

    assert.equal((await source.skipStep('plan')).current, 'connect');
    assert.equal((await source.skipStep('connect')).current, 'catalogue');
    await assert.rejects(() => source.skipStep('catalogue'), rejectsWith(422, 'step'), 'real size cannot be skipped');

    const home = await source.dashboard();
    const connect = home.onboarding.steps.find((s) => s.key === 'connect')!;
    assert.deepEqual([connect.done, connect.skipped], [false, true], 'the home checklist shows the skip');
    assert.equal(home.onboarding.steps.find((s) => s.key === 'store')!.done, true);

    assert.equal((await source.unskipStep('connect')).current, 'connect');
  } finally { await harness.close(); resetEnv(); }
});
