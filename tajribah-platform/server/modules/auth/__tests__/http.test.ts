/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditLogs, sessions, tenantMemberships, tenants, users } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { uuidv7 } from '@/lib/ids';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { configureNotify } from '@/server/core/notify/notify';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { setLogLevel } from '@/server/core/observability/log';
import { REFRESH_COOKIE } from '@/server/core/auth/session';
import { createTestDb, type TestDb } from '@/server/testing/harness';
import {
  addStoreHandler, confirmResetHandler, loginHandler, logoutHandler, meHandler, refreshHandler, registerHandler,
  requestResetHandler, resendVerificationHandler, switchTenantHandler, verifyEmailHandler,
} from '@/server/modules/auth/http';

const APP = 'http://localhost:5173';

function setup() {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
  setRateLimiter(new MemoryRateLimiter());
  setLogLevel('error');
}

/** A browser-shaped same-origin request. */
function req(path: string, init: { method?: string; body?: unknown; token?: string; cookie?: string; origin?: string } = {}): Request {
  const headers: Record<string, string> = { origin: init.origin ?? APP };
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  if (init.token) headers.authorization = `Bearer ${init.token}`;
  if (init.cookie) headers.cookie = init.cookie;
  return new Request(`${APP}${path}`, {
    method: init.method ?? 'POST', headers,
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
}

/** `tajribah_rt=…` from a response, ready to send back as a Cookie header. */
function cookieFrom(response: Response): string | null {
  const setCookie = response.headers.get('set-cookie') ?? '';
  const match = new RegExp(`${REFRESH_COOKIE}=([^;]*)`).exec(setCookie);
  return match && match[1] ? `${REFRESH_COOKIE}=${match[1]}` : null;
}

/** Everything console.log printed while `fn` ran — where the dev email adapter writes. */
async function printed(fn: () => Promise<unknown>): Promise<string> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => { lines.push(args.join(' ')); };
  try { await fn(); } finally { console.log = original; }
  return lines.join('\n');
}

const ACCOUNT = { email: 'owner@example.test', password: 'a-long-enough-password', fullName: 'نادر', storeName: 'متجر الساعات' };

async function signUp(harness: TestDb) {
  void harness;
  let response!: Response;
  const mail = await printed(async () => { response = await registerHandler(req('/api/auth/register', { body: ACCOUNT })); });
  const body = await response.json() as any;
  return { response, body, mail, cookie: cookieFrom(response)!, token: body.accessToken as string };
}

test('register: 201, a session, the refresh token only in an httpOnly cookie, and a verification email', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { response, body, mail, cookie } = await signUp(harness);
    assert.equal(response.status, 201);
    assert.ok(response.headers.get('x-request-id'));
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.ok(body.accessToken && body.tenant.id && body.user.email === 'owner@example.test');
    assert.equal(body.slugNeedsConfirmation, true, 'an Arabic store name cannot be slugified — the user confirms one');
    assert.ok(!JSON.stringify(body).includes(cookie.split('=')[1]), 'the refresh token never appears in a body');
    const setCookie = response.headers.get('set-cookie')!;
    assert.match(setCookie, /HttpOnly/);
    assert.match(setCookie, /SameSite=Lax/);
    assert.match(setCookie, /Path=\/api\/auth/);
    assert.match(mail, /أكّد بريدك الإلكتروني/, 'the verification email goes out in Arabic by default');
    assert.match(mail, /\/verify-email\?token=/);
  } finally { await harness.close(); }
});

test('register refuses a weak password with a field error', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const response = await registerHandler(req('/api/auth/register', { body: { ...ACCOUNT, password: 'short' } }));
    assert.equal(response.status, 422);
    const body = await response.json() as any;
    assert.deepEqual(Object.keys(body.errors), ['password']);
  } finally { await harness.close(); }
});

test('login: a wrong password and an unknown address get the identical answer', async () => {
  setup();
  const harness = await createTestDb();
  try {
    await signUp(harness);
    const wrong = await loginHandler(req('/api/auth/login', { body: { email: ACCOUNT.email, password: 'nope-nope-nope' } }));
    const unknown = await loginHandler(req('/api/auth/login', { body: { email: 'nobody@example.test', password: 'nope-nope-nope' } }));
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    const strip = async (r: Response) => { const b = await r.json() as any; delete b.requestId; return b; };
    assert.deepEqual(await strip(wrong), await strip(unknown));

    const ok = await loginHandler(req('/api/auth/login', { body: { email: ACCOUNT.email.toUpperCase(), password: ACCOUNT.password } }));
    assert.equal(ok.status, 200);
    assert.ok(cookieFrom(ok));
  } finally { await harness.close(); }
});

test('me: 401 without a token, with a tampered token, and after logout', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { token, cookie, body: signed } = await signUp(harness);

    const me = await meHandler(req('/api/auth/me', { method: 'GET', token }));
    assert.equal(me.status, 200);
    const who = await me.json() as any;
    assert.equal(who.user.email, ACCOUNT.email);
    assert.equal(who.currentTenantId, signed.tenant.id);
    assert.deepEqual(who.tenants.map((t: any) => t.role), ['owner']);

    assert.equal((await meHandler(req('/api/auth/me', { method: 'GET' }))).status, 401);
    const tampered = token.slice(0, -2) + (token.endsWith('A') ? 'BB' : 'AA');
    assert.equal((await meHandler(req('/api/auth/me', { method: 'GET', token: tampered }))).status, 401);

    const out = await logoutHandler(req('/api/auth/logout', { cookie }));
    assert.equal(out.status, 204);
    assert.match(out.headers.get('set-cookie')!, /Max-Age=0/);
    assert.equal((await meHandler(req('/api/auth/me', { method: 'GET', token }))).status, 401,
      'a signed-out session stops working at once, not when its access token expires');
  } finally { await harness.close(); }
});

test('refresh rotates the cookie; replaying the old one is refused and kills the family', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { cookie: first } = await signUp(harness);
    const rotated = await refreshHandler(req('/api/auth/refresh', { cookie: first }));
    assert.equal(rotated.status, 200);
    const second = cookieFrom(rotated)!;
    assert.notEqual(second, first);
    const { accessToken } = await rotated.json() as any;

    const replay = await refreshHandler(req('/api/auth/refresh', { cookie: first }));
    assert.equal(replay.status, 401);
    assert.equal(replay.headers.get('content-type'), 'application/problem+json; charset=utf-8');
    assert.match(replay.headers.get('set-cookie')!, /Max-Age=0/, 'a refused refresh clears the cookie');

    assert.equal((await refreshHandler(req('/api/auth/refresh', { cookie: second }))).status, 401, 'the thief and the user are both signed out');
    assert.equal((await meHandler(req('/api/auth/me', { method: 'GET', token: accessToken }))).status, 401);
    assert.equal((await refreshHandler(req('/api/auth/refresh'))).status, 401, 'no cookie, no session');
  } finally { await harness.close(); }
});

test('cross-origin requests to cookie-bearing endpoints are refused', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { cookie } = await signUp(harness);
    for (const [handler, path, body] of [
      [refreshHandler, '/api/auth/refresh', undefined],
      [logoutHandler, '/api/auth/logout', undefined],
      [loginHandler, '/api/auth/login', { email: ACCOUNT.email, password: ACCOUNT.password }],
    ] as const) {
      const response = await handler(req(path, { cookie, body, origin: 'https://evil.example' }));
      assert.equal(response.status, 403, `${path} accepted a cross-origin request`);
    }
    // The session survived the forged logout.
    assert.equal((await refreshHandler(req('/api/auth/refresh', { cookie }))).status, 200);
  } finally { await harness.close(); }
});

test('switch-tenant: a store you belong to works; one you do not is a 404, and the session is unchanged', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { token, body } = await signUp(harness);
    const second = uuidv7();
    const stranger = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(tenants).values([
        { id: second, slug: 'second', name: 'Second', status: 'active' },
        { id: stranger, slug: 'stranger', name: 'Stranger', status: 'active' },
      ] as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: second, userId: body.user.id, role: 'editor', status: 'active' } as any);
    });

    const refused = await switchTenantHandler(req('/api/auth/switch-tenant', { token, body: { tenantId: stranger } }));
    assert.equal(refused.status, 404, 'a store you are not in must look like one that does not exist');
    const still = await (await meHandler(req('/api/auth/me', { method: 'GET', token }))).json() as any;
    assert.equal(still.currentTenantId, body.tenant.id);

    const switched = await switchTenantHandler(req('/api/auth/switch-tenant', { token, body: { tenantId: second } }));
    assert.equal(switched.status, 200);
    const { accessToken } = await switched.json() as any;
    const now = await (await meHandler(req('/api/auth/me', { method: 'GET', token: accessToken }))).json() as any;
    assert.equal(now.currentTenantId, second);
  } finally { await harness.close(); }
});

test('password reset: identical answer for known and unknown addresses; confirming ends every session', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { cookie } = await signUp(harness);
    let known!: Response;
    let unknown!: Response;
    const mail = await printed(async () => {
      known = await requestResetHandler(req('/api/auth/password-reset', { body: { email: ACCOUNT.email } }));
      unknown = await requestResetHandler(req('/api/auth/password-reset', { body: { email: 'nobody@example.test' } }));
    });
    assert.equal(known.status, 202);
    assert.equal(unknown.status, 202);
    assert.deepEqual(await known.json(), await unknown.json());
    assert.ok(!mail.includes('nobody@example.test'), 'no email goes to an address with no account');
    const token = decodeURIComponent(/reset-password\?token=([^\s]+)/.exec(mail)![1]);

    const bad = await confirmResetHandler(req('/api/auth/password-reset/confirm', { body: { token: 'x'.repeat(20), password: 'another-long-password' } }));
    assert.equal(bad.status, 422);
    const ok = await confirmResetHandler(req('/api/auth/password-reset/confirm', { body: { token, password: 'another-long-password' } }));
    assert.equal(ok.status, 204);
    assert.equal((await refreshHandler(req('/api/auth/refresh', { cookie }))).status, 401, 'the old session is gone');
    const again = await confirmResetHandler(req('/api/auth/password-reset/confirm', { body: { token, password: 'a-third-long-password' } }));
    assert.equal(again.status, 422, 'a reset link works once');

    const login = await loginHandler(req('/api/auth/login', { body: { email: ACCOUNT.email, password: 'another-long-password' } }));
    assert.equal(login.status, 200);
  } finally { await harness.close(); }
});

test('verify-email accepts the emailed token once', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { mail, token: access } = await signUp(harness);
    const token = decodeURIComponent(/verify-email\?token=([^\s]+)/.exec(mail)![1]);
    assert.equal((await verifyEmailHandler(req('/api/auth/verify-email', { body: { token } }))).status, 204);
    assert.equal((await verifyEmailHandler(req('/api/auth/verify-email', { body: { token } }))).status, 422);
    const me = await (await meHandler(req('/api/auth/me', { method: 'GET', token: access }))).json() as any;
    assert.equal(me.user.emailVerified, true);
  } finally { await harness.close(); }
});

test('refresh is rate limited per session (§13.6), not for everyone behind the same address', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const hammered = `${REFRESH_COOKIE}=one-cookie-sent-in-a-loop`;
    const statuses: number[] = [];
    for (let i = 0; i < 61; i++) statuses.push((await refreshHandler(req('/api/auth/refresh', { cookie: hammered }))).status);
    assert.deepEqual([...new Set(statuses.slice(0, 60))], [401], 'sixty a minute are answered');
    assert.equal(statuses[60], 429, 'the sixty-first waits');
    const other = await refreshHandler(req('/api/auth/refresh', { cookie: `${REFRESH_COOKIE}=another-session` }));
    assert.equal(other.status, 401, 'another session on the same address is not held up');
  } finally { await harness.close(); }
});

test('verify-email resend (API-010): own address only, refused cross-site, and rate limited per user', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { token } = await signUp(harness);
    assert.equal((await resendVerificationHandler(req('/api/auth/verify-email/resend'))).status, 401);
    assert.equal((await resendVerificationHandler(req('/api/auth/verify-email/resend', { token, origin: 'https://evil.example' }))).status, 403);

    const statuses: number[] = [];
    const mail = await printed(async () => {
      for (let i = 0; i < 6; i++) statuses.push((await resendVerificationHandler(req('/api/auth/verify-email/resend', { token }))).status);
    });
    assert.deepEqual(statuses, [202, 202, 202, 202, 202, 429], 'five resends an hour, then a wait');
    assert.equal(mail.match(/verify-email\?token=/g)?.length, 5);
    assert.deepEqual([...new Set(mail.match(/email to (\S+)/g))], ['email to owner@example.test'], 'every resend goes to the account’s own address');
  } finally { await harness.close(); }
});

test("sign-in and sign-out are in the store's audit trail, once each, with the request id", async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { body } = await signUp(harness);
    const login = await loginHandler(req('/api/auth/login', { body: { email: ACCOUNT.email, password: ACCOUNT.password } }));
    const cookie = cookieFrom(login)!;
    await logoutHandler(req('/api/auth/logout', { cookie }));
    await logoutHandler(req('/api/auth/logout', { cookie })); // a second sign-out of the same session
    await loginHandler(req('/api/auth/login', { body: { email: ACCOUNT.email, password: 'wrong-wrong-wrong' } }));

    const rows = await harness.asAdmin(() => harness.db.select().from(auditLogs));
    const events = rows.filter((r) => r.resourceType === 'session').map((r) => r.action);
    assert.deepEqual(events, ['login', 'logout'], 'one login, one logout; a failed login and a repeated logout add nothing');
    const loginRow = rows.find((r) => r.action === 'login')!;
    assert.equal(loginRow.tenantId, body.tenant.id);
    assert.equal(loginRow.actorUserId, body.user.id);
    assert.equal(loginRow.requestId, login.headers.get('x-request-id'));
  } finally { await harness.close(); }
});

test('a body that is not JSON is a 422, not a crash', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const response = await loginHandler(new Request(`${APP}/api/auth/login`, { method: 'POST', headers: { origin: APP }, body: '{not json' }));
    assert.equal(response.status, 422);
  } finally { await harness.close(); resetEnv(); }
});

test('add a store (T30): its own 14-day trial, you as owner, the session moves to it — once your address is confirmed', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { token, body } = await signUp(harness);
    const unconfirmed = await addStoreHandler(req('/api/auth/stores', { token, body: { storeName: 'متجر ثانٍ' } }));
    assert.equal(unconfirmed.status, 403, 'confirm the address first: every store starts a free trial');
    await harness.asAdmin(() => harness.db.update(users).set({ emailVerifiedAt: new Date() } as any).where(eq(users.id, body.user.id)));

    assert.equal((await addStoreHandler(req('/api/auth/stores', { token, body: { storeName: '   ' } }))).status, 422, 'a name is needed');
    const before = Date.now();
    const created = await addStoreHandler(req('/api/auth/stores', { token, body: { storeName: 'متجر ثانٍ' } }));
    assert.equal(created.status, 201);
    const { accessToken, tenantId } = await created.json() as any;
    const me = await (await meHandler(req('/api/auth/me', { method: 'GET', token: accessToken }))).json() as any;
    assert.equal(me.currentTenantId, tenantId, 'the session acts for the new store');
    assert.deepEqual(me.tenants.map((t: any) => t.role).sort(), ['owner', 'owner'], 'both stores, owner of each');

    const [store] = await harness.asAdmin(() => harness.db.select().from(tenants).where(eq(tenants.id, tenantId)));
    assert.equal(store!.status, 'trial');
    const days = (store!.trialEndsAt!.getTime() - before) / 86_400_000;
    assert.ok(days > 13.99 && days < 14.01, `its own 14-day trial, got ${days}`);
    assert.deepEqual(store!.onboardingState, { step: 'store', completedSteps: ['account'] }, 'set up from the store step, like the first');
    assert.notEqual(store!.slug, body.tenant.slug);
    const trail = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.tenantId, tenantId)));
    assert.deepEqual(trail.map((a: any) => [a.action, a.resourceType, a.actorUserId]), [['create', 'tenant', body.user.id]]);
    const firstStoreTrail = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.tenantId, body.tenant.id)));
    assert.ok(!firstStoreTrail.some((a: any) => a.resourceType === 'tenant' && a.resourceId === tenantId), 'recorded in the new store, not the old one');
  } finally { await harness.close(); }
});

test('add a store: not from a staff view, and a handful a day', async () => {
  setup();
  const harness = await createTestDb();
  try {
    const { token, body } = await signUp(harness);
    await harness.asAdmin(() => harness.db.update(users).set({ emailVerifiedAt: new Date() } as any).where(eq(users.id, body.user.id)));
    await harness.asAdmin(() => harness.db.update(sessions).set({ impersonatingUntil: new Date(Date.now() + 3_600_000) } as any).where(eq(sessions.userId, body.user.id)));
    assert.equal((await addStoreHandler(req('/api/auth/stores', { token, body: { storeName: 'X' } }))).status, 403, 'a staff view looks, it does not act');
    await harness.asAdmin(() => harness.db.update(sessions).set({ impersonatingUntil: null } as any).where(eq(sessions.userId, body.user.id)));
    let latest = token;
    for (let i = 1; i <= 5; i++) {
      const r = await addStoreHandler(req('/api/auth/stores', { token: latest, body: { storeName: `Store ${i}` } }));
      assert.equal(r.status, 201, `store ${i}`);
      latest = (await r.json() as any).accessToken;
    }
    assert.equal((await addStoreHandler(req('/api/auth/stores', { token: latest, body: { storeName: 'Store 6' } }))).status, 429);
    assert.equal((await addStoreHandler(req('/api/auth/stores', { token: latest, body: { storeName: 'Y' }, origin: 'https://evil.example' }))).status, 403, 'same origin only');
  } finally { await harness.close(); }
});

