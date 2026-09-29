/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P2.11 — a lapsed trial is read-only everywhere writes happen, with the reason; reminders
 * go out three days before, on the last day and at the end — once each.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { notifications, subscriptions, tenantMemberships, tenants, users } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { PERMISSIONS } from '@/lib/permissions';
import { allowedWhileReadOnly, writeStateOf } from '@/server/core/billing/lifecycle';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { configureNotify } from '@/server/core/notify/notify';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { MemoryStorage, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, seededPlanId, type TestDb } from '@/server/testing/harness';
import * as auth from '@/server/modules/auth/http';
import * as products from '@/server/modules/products/http';
import * as team from '@/server/modules/team/http';
import * as ar from '@/server/modules/ar/http';
import * as settings from '@/server/modules/settings/http';
import * as onboarding from '@/server/modules/onboarding/http';
import * as models from '@/server/modules/models/http';
import { sendTrialReminders, milestoneOf } from '@/server/modules/billing/trial';

setLogLevel('error');
const DAY = 86_400_000;
const APP = 'http://localhost:5173';
const past = () => new Date(Date.now() - DAY);

test('the rule: a trial that ended, or a subscription that did, is read-only; past-due is not', () => {
  const now = new Date('2026-10-10T00:00:00Z');
  const ended = new Date('2026-10-01T00:00:00Z');
  const later = new Date('2026-10-20T00:00:00Z');
  const cases: [any, Date | null, string | null][] = [
    [null, later, null], [null, ended, 'trial_ended'], [null, null, null],
    ['trialing', later, null], ['trialing', ended, 'trial_ended'],
    ['active', ended, null], ['past_due', ended, null],
    ['paused', later, 'subscription_ended'], ['cancelled', later, 'subscription_ended'], ['expired', null, 'subscription_ended'],
  ];
  for (const [status, trialEndsAt, readOnly] of cases) {
    assert.equal(writeStateOf({ subscriptionStatus: status, trialEndsAt, now }).readOnly, readOnly, `${status} / ${trialEndsAt?.toISOString()}`);
  }
  const stillAllowed = PERMISSIONS.filter((p) => !p.endsWith(':read') && allowedWhileReadOnly(p));
  // P8: api_keys:manage too — seeing and revoking a key (a leaked one cannot wait for a plan); making one is refused in createApiKey.
  assert.deepEqual(stillAllowed.sort(), ['analytics:export', 'api_keys:manage', 'billing:write', 'settings:write'], 'only the way out stays open');
});

async function owner(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  const ctx = () => buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `req-${name}` });
  return { ...seeded, ctx };
}

test('in the request context: every write permission refused while read-only (402, the reason named); reads and the way out allowed', async () => {
  const harness = await createTestDb();
  try {
    const store = await owner(harness, 'alpha');
    assert.equal((await store.ctx()).readOnly, null);
    await harness.asAdmin(() => harness.db.update(tenants).set({ trialEndsAt: past() }).where(eq(tenants.id, store.tenantId)));

    const ctx = await store.ctx();
    assert.equal(ctx.readOnly, 'trial_ended');
    for (const permission of PERMISSIONS) {
      if (allowedWhileReadOnly(permission)) {
        assert.doesNotThrow(() => ctx.require(permission), permission);
        assert.equal(ctx.can(permission), true, permission);
      } else {
        assert.throws(() => ctx.require(permission), (e: any) => e.code === 'store_read_only' && e.status === 402 && /trial has ended/.test(e.message), permission);
        assert.equal(ctx.can(permission), false, permission);
      }
    }

    // Choosing a plan lifts it on the next request; a cancelled one brings it back, with its own reason.
    const planId = await seededPlanId(harness, 'growth');
    const [sub] = await harness.asAdmin(() => harness.db.insert(subscriptions).values({
      tenantId: store.tenantId, planId, status: 'active', currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 30 * DAY),
    } as any).returning());
    assert.equal((await store.ctx()).readOnly, null);
    await harness.asAdmin(() => harness.db.update(subscriptions).set({ status: 'cancelled' }).where(eq(subscriptions.id, sub.id)));
    const cancelled = await store.ctx();
    assert.equal(cancelled.readOnly, 'subscription_ended');
    assert.throws(() => cancelled.require('products:write'), /subscription has ended/);
  } finally { await harness.close(); }
});

test('everywhere, through the real endpoints: a lapsed store is refused on every kind of write, can still fix its settings, and /me says why', async () => {
  resetEnv();
  loadEnv({ APP_URL: APP, AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
  setRateLimiter(new MemoryRateLimiter());
  setStorage(new MemoryStorage());
  const harness = await createTestDb();
  try {
    const quiet = console.log;
    console.log = () => {};
    let registered: Response;
    try {
      registered = await auth.registerHandler(new Request(`${APP}/api/auth/register`, {
        method: 'POST', headers: { origin: APP, 'content-type': 'application/json' },
        body: JSON.stringify({ email: 'owner@example.test', password: 'a-long-enough-password', fullName: 'Owner', storeName: 'Oud House' }),
      }));
    } finally { console.log = quiet; }
    const body = await registered!.json() as any;
    const token = body.accessToken as string;
    await harness.asAdmin(() => harness.db.update(tenants).set({ trialEndsAt: past() }).where(eq(tenants.id, body.tenant.id)));

    const call = (handler: (r: Request) => Promise<Response>, path: string, method: string, payload?: unknown) => handler(new Request(`${APP}${path}`, {
      method, headers: { origin: APP, authorization: `Bearer ${token}`, ...(payload ? { 'content-type': 'application/json' } : {}) },
      body: payload ? JSON.stringify(payload) : undefined,
    }));
    const pid = uuidv7();
    const writes: [string, Promise<Response>][] = [
      ['create a product', call(products.createProductHandler, '/api/products', 'POST', { name: 'Oyster' })],
      ['edit a product', call(products.updateProductHandler, `/api/products/${pid}`, 'PATCH', { arEnabled: true })],
      ['delete a product', call(products.deleteProductHandler, `/api/products/${pid}`, 'DELETE')],
      ['invite someone', call(team.inviteHandler, '/api/team/invitations', 'POST', { email: 'a@example.test', role: 'editor' })],
      ['save AR settings', call(ar.saveArConfigHandler, `/api/ar-configs/${pid}`, 'PUT', { buttonLabelAr: 'شاهد', buttonLabelEn: 'View', variant: 'filled', showIcon: true, placement: 'floor', scale: 1, autoRotate: true, shadow: 1 })],
      ['publish a model version', call(models.publishVersionHandler, `/api/models/versions/${pid}/publish`, 'POST')],
      ['upload a model', call(models.startUploadHandler, '/api/models/uploads', 'POST', { filename: 'watch.glb', sizeBytes: 100 })],
    ];
    for (const [what, pending] of writes) {
      const response = await pending;
      const problem = await response.json() as any;
      assert.equal(response.status, 402, `${what}: ${response.status} ${JSON.stringify(problem)}`);
      assert.equal(problem.code, 'store_read_only', what);
    }

    const fixed = await call(settings.updateSettingsHandler, '/api/settings', 'PATCH', { crNumber: '1010123456' });
    assert.equal(fixed.status, 200, 'the business details an invoice needs can still be fixed');
    // Setup steps are the store's own details (settings:write), not content: left open on purpose.
    assert.equal((await call(onboarding.skipStepHandler, '/api/onboarding/skip', 'POST', { step: 'plan' })).status, 200);
    assert.equal((await call(products.listProductsHandler, '/api/products', 'GET')).status, 200, 'reading works');

    const me = await (await call(auth.meHandler, '/api/auth/me', 'GET')).json() as any;
    assert.equal(me.tenants[0].readOnly, 'trial_ended');
  } finally { await harness.close(); resetEnv(); }
});

test('reminders: three days before, the last day, the end — once each, to billing people only, never to a paying store', async () => {
  configureNotify({ EMAIL_PROVIDER: 'console', SMS_PROVIDER: 'console' });
  const harness = await createTestDb();
  try {
    const now = new Date('2026-10-10T09:00:00Z');
    const store = await owner(harness, 'alpha');
    const paying = await owner(harness, 'bravo');
    const editorId = uuidv7();
    const growth = await seededPlanId(harness, 'growth');
    await harness.asAdmin(async () => {
      await harness.db.update(tenants).set({ status: 'trial', trialEndsAt: new Date(now.getTime() + 2.5 * DAY) }).where(eq(tenants.id, store.tenantId));
      await harness.db.update(tenants).set({ status: 'trial', trialEndsAt: new Date(now.getTime() + 2.5 * DAY) }).where(eq(tenants.id, paying.tenantId));
      await harness.db.insert(subscriptions).values({ tenantId: paying.tenantId, planId: growth, status: 'active', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * DAY) } as any);
      await harness.db.insert(users).values({ id: editorId, email: 'editor@example.test', passwordHash: 'x', fullName: 'e' } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId: store.tenantId, userId: editorId, role: 'editor', status: 'active' } as any);
    });

    const mails: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => { mails.push(args.join(' ')); };
    try {
      await sendTrialReminders(now);
      await sendTrialReminders(new Date(now.getTime() + 3_600_000)); // the next tick: nothing new
      await sendTrialReminders(new Date(now.getTime() + 2 * DAY));   // 12 hours left
      await sendTrialReminders(new Date(now.getTime() + 3 * DAY));   // ended
      await sendTrialReminders(new Date(now.getTime() + 4 * DAY));   // still ended: nothing new
      await sendTrialReminders(new Date(now.getTime() + 12 * DAY));  // long after: nothing
    } finally { console.log = original; }

    const rows = await harness.asAdmin(() => harness.db.select().from(notifications));
    assert.deepEqual(rows.filter((r) => r.tenantId === store.tenantId).map((r) => r.type), ['trial.three_days', 'trial.last_day', 'trial.ended']);
    assert.ok(rows.every((r) => r.userId === store.userId), 'the owner, not the editor');
    assert.equal(rows.filter((r) => r.tenantId === paying.tenantId).length, 0, 'a store that chose a plan hears nothing');
    const sent = mails.join('\n').match(/email to (\S+)/g) ?? [];
    assert.deepEqual(sent, ['email to alpha@example.test', 'email to alpha@example.test', 'email to alpha@example.test']);
    assert.match(mails.join('\n'), /تبقّت 3 أيام/);
  } finally { await harness.close(); }
});

test('which reminder is due', () => {
  const end = new Date('2026-10-20T00:00:00Z');
  const at = (hoursBefore: number) => new Date(end.getTime() - hoursBefore * 3_600_000);
  assert.deepEqual([at(80), at(72), at(30), at(24), at(1), at(0), at(-24 * 6), at(-24 * 8)].map((d) => milestoneOf(end, d)),
    [null, 'three_days', 'three_days', 'last_day', 'last_day', 'ended', 'ended', null]);
});
