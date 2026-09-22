/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P0.20 — login → dashboard → logout, end to end: the real `ApiClient`, the real handlers,
 * a real Postgres (PGlite). The only stand-in is the browser: `browser()` routes fetch to the
 * handler for the path and keeps the cookie jar, sending the refresh cookie back exactly as
 * a browser would (httpOnly — the client code never sees it).
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
import * as http from '@/server/modules/auth/http';
import * as products from '@/server/modules/products/http';

const APP = 'http://localhost:5173';
const HANDLERS: Record<string, (r: Request) => Promise<Response>> = {
  '/api/auth/register': http.registerHandler,
  '/api/auth/login': http.loginHandler,
  '/api/auth/refresh': http.refreshHandler,
  '/api/auth/logout': http.logoutHandler,
  '/api/auth/me': http.meHandler,
  '/api/auth/switch-tenant': http.switchTenantHandler,
  '/api/auth/password-reset': http.requestResetHandler,
  '/api/products': products.listProductsHandler,
};

/** A browser: same-origin fetch into the handlers, with a cookie jar. Counts calls per path. */
function browser() {
  const jar = new Map<string, string>();
  const calls: Record<string, number> = {};
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input, APP);
    calls[url.pathname] = (calls[url.pathname] ?? 0) + 1;
    const headers = new Headers(init.headers);
    headers.set('origin', APP);
    headers.set('sec-fetch-site', 'same-origin');
    // Path=/api/auth on the refresh cookie: the browser only sends it there.
    if (jar.size && url.pathname.startsWith('/api/auth')) {
      headers.set('cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
    }
    const handler = HANDLERS[url.pathname] ?? (url.pathname.startsWith('/api/products/') ? products.getProductHandler : undefined);
    if (!handler) return new Response(null, { status: 404 });
    const response = await handler(new Request(url, { ...init, headers }));
    const setCookie = response.headers.get('set-cookie');
    if (setCookie) {
      const [pair] = setCookie.split(';');
      const [name, value] = pair.split('=');
      if (/Max-Age=0/.test(setCookie) || !value) jar.delete(name); else jar.set(name, value);
    }
    return response;
  }) as typeof fetch;
  return { fetchImpl, jar, calls };
}

function setup() {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
  setRateLimiter(new MemoryRateLimiter());
  setLogLevel('error');
}

const quiet = async <T>(fn: () => Promise<T>): Promise<T> => {
  const original = console.log;
  console.log = () => {};
  try { return await fn(); } finally { console.log = original; }
};

const ACCOUNT = { email: 'owner@example.test', password: 'a-long-enough-password', fullName: 'نادر', storeName: 'Oud House' };

test('sign up → dashboard data → reload → sign out → sign in', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const tab = browser();
    const client = new ApiClient(tab.fetchImpl);

    assert.equal(await client.restore(), false, 'a fresh browser has no session');
    await quiet(() => client.register(ACCOUNT));
    assert.equal(client.signedIn, true);
    assert.ok(tab.jar.has('tajribah_rt'), 'the refresh cookie is in the jar, not in the client');

    const store = await apiSource(client).currentTenant();
    assert.equal(store.name, 'Oud House');
    assert.equal(store.slug, 'oud-house');
    assert.equal(store.plan, 'starter');
    assert.equal(store.status, 'trial');
    assert.equal(store.role, 'owner');
    assert.ok(store.trialEndsAt);

    // A reload: new client (memory gone), same cookie jar.
    const reloaded = new ApiClient(tab.fetchImpl);
    assert.equal(await reloaded.restore(), true, 'the cookie restores the session after a reload');
    assert.equal((await reloaded.me()).user.email, ACCOUNT.email);

    await reloaded.logout();
    assert.equal(reloaded.signedIn, false);
    assert.equal(tab.jar.has('tajribah_rt'), false, 'sign-out clears the cookie');
    await assert.rejects(() => reloaded.me(), (e: any) => e instanceof ApiError && e.status === 401);
    assert.equal(await new ApiClient(tab.fetchImpl).restore(), false, 'and a later reload stays signed out');

    await client.login(ACCOUNT.email, ACCOUNT.password);
    assert.equal((await client.me()).tenants.length, 1);
  } finally { await harness.close(); }
});

test('an expired access token is refreshed once and the call retried — even for concurrent calls', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const tab = browser();
    const client = new ApiClient(tab.fetchImpl);
    await quiet(() => client.register(ACCOUNT));
    const refreshesBefore = tab.calls['/api/auth/refresh'] ?? 0;

    (client as any).accessToken = 'expired.or.garbage';
    const results = await Promise.all(Array.from({ length: 5 }, () => client.me()));
    assert.ok(results.every((r) => r.user.email === ACCOUNT.email));
    assert.equal((tab.calls['/api/auth/refresh'] ?? 0) - refreshesBefore, 1,
      'five 401s share one refresh — two would reuse the rotated token and sign the user out');
    assert.equal(client.signedIn, true);
  } finally { await harness.close(); }
});

test('signed out elsewhere: the next call fails, the client says so, and listeners hear it', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const tab = browser();
    const client = new ApiClient(tab.fetchImpl);
    await quiet(() => client.register(ACCOUNT));
    const heard: boolean[] = [];
    client.onChange((signedIn) => heard.push(signedIn));

    await new ApiClient(tab.fetchImpl).logout(); // another tab signs out (same cookie jar)
    await assert.rejects(() => client.me(), (e: any) => e.status === 401);
    assert.equal(client.signedIn, false);
    assert.deepEqual(heard, [false], 'the UI is told once, so RequireSession can redirect');
  } finally { await harness.close(); }
});

test('refusals arrive as typed errors the forms can explain', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const client = new ApiClient(browser().fetchImpl);
    await quiet(() => client.register(ACCOUNT));
    await client.logout();

    await assert.rejects(() => client.login(ACCOUNT.email, 'wrong-wrong-wrong'),
      (e: any) => e instanceof ApiError && e.code === 'invalid_credentials' && e.status === 401 && !!e.requestId);
    await assert.rejects(() => quiet(() => client.register({ ...ACCOUNT, password: 'short' })),
      (e: any) => e.code === 'validation_failed' && 'password' in e.fields);
    await assert.rejects(() => quiet(() => client.register(ACCOUNT)), (e: any) => e.code === 'conflict');

    await client.login(ACCOUNT.email, ACCOUNT.password);
    await assert.rejects(() => apiSource(client).models(), (e: any) => e.status === 501,
      'screens without an API yet say so — they do not fall back to demo numbers');
    assert.deepEqual(await apiSource(client).products(), [], 'a new store has an empty catalogue, from the real API');
    assert.equal(await apiSource(client).product('01a0cb1d-0000-7000-8000-000000000000'), null, 'an unknown product is null, not an error');
  } finally { await harness.close(); resetEnv(); }
});
