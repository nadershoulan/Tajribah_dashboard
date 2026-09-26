/* eslint-disable @typescript-eslint/no-explicit-any */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  analyticsEvents, auditLogs, models3d, products, storeConnections, subscriptions,
  tenantMemberships, tenants, users,
} from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { setLogLevel } from '@/server/core/observability/log';
import { createTestDb, seedTenant, seededPlanId, type TestDb } from '@/server/testing/harness';
import { SKIPPABLE, STEPS, evaluate, skip, type Facts } from '@/server/modules/onboarding/machine';
import { confirmStoreStep, onboardingOf, skipStep, unskipStep } from '@/server/modules/onboarding/service';

setLogLevel('error');

const NONE: Facts = { storeConfirmed: false, hasPlan: false, hasActiveConnection: false, hasSizedProduct: false, hasReadyModel: false, widgetSeen: false };
const ALL: Facts = { storeConfirmed: true, hasPlan: true, hasActiveConnection: true, hasSizedProduct: true, hasReadyModel: true, widgetSeen: true };

// ------------------------------------------------------------------ pure rules

test('a new store starts at "store", with only the account done', () => {
  const view = evaluate(NONE, null);
  assert.equal(view.current, 'store');
  assert.deepEqual(view.steps.filter((s) => s.done).map((s) => s.key), ['account']);
  assert.equal(view.complete, false);
  assert.equal(view.steps.filter((s) => s.current).length, 1, 'exactly one current step');
});

test('only plan and connect can be skipped; a finished step cannot be skipped', () => {
  assert.deepEqual([...SKIPPABLE].sort(), ['connect', 'plan']);
  for (const step of STEPS.filter((s) => !SKIPPABLE.has(s))) {
    assert.throws(() => skip(null, step, NONE), /cannot be skipped/, step);
  }
  assert.throws(() => skip(null, 'plan', { ...NONE, hasPlan: true }), /already done/);
});

test('skipping moves the checklist on; a skipped step that later happens shows as done', () => {
  const skipped = skip(skip(null, 'plan', { ...NONE, storeConfirmed: true }), 'connect', { ...NONE, storeConfirmed: true });
  const view = evaluate({ ...NONE, storeConfirmed: true }, skipped);
  assert.equal(view.current, 'catalogue');
  assert.deepEqual(view.steps.filter((s) => s.skipped).map((s) => s.key), ['plan', 'connect']);

  const later = evaluate({ ...NONE, storeConfirmed: true, hasActiveConnection: true }, skipped);
  const connect = later.steps.find((s) => s.key === 'connect')!;
  assert.equal(connect.done, true);
  assert.equal(connect.skipped, false);
});

test('every fact true means complete, whatever was stored', () => {
  const view = evaluate(ALL, { step: 'store', completedSteps: [] });
  assert.equal(view.complete, true);
  assert.equal(view.current, null);
  assert.ok(view.steps.every((s) => s.done));
});

// ------------------------------------------------------------- against the database

async function store(harness: TestDb, name: string) {
  const seeded = await seedTenant(harness, name);
  const ctx = await buildTenantContext({
    actor: { userId: seeded.userId, email: seeded.email, isStaff: false },
    tenantId: seeded.tenantId, requestId: `req-${name}`,
  });
  return { ...seeded, ctx };
}

const plant = (harness: TestDb, table: any, rows: any) => harness.asAdmin(() => harness.db.insert(table).values(rows));

test('each step turns done when its fact appears in the database — and only for its own store', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const other = await store(harness, 'bravo');
    assert.equal((await onboardingOf(ctx)).current, 'store');

    // Everything for the *other* store first: none of it may count for alpha.
    await plant(harness, storeConnections, { tenantId: other.tenantId, provider: 'salla', externalStoreId: 'b-1', status: 'active' });
    await plant(harness, products, { tenantId: other.tenantId, name: 'B', dimensions: { widthMm: 40, heightMm: 48 } });
    await plant(harness, models3d, { tenantId: other.tenantId, name: 'B', source: 'uploaded', status: 'ready' });
    await plant(harness, analyticsEvents, { tenantId: other.tenantId, eventType: 'product_view', sessionId: 's', occurredAt: new Date() });
    assert.deepEqual((await onboardingOf(ctx)).steps.filter((s) => s.done).map((s) => s.key), ['account'],
      "another store's facts leaked into this checklist");

    await confirmStoreStep(ctx);
    assert.equal((await onboardingOf(ctx)).current, 'plan');

    const planId = await seededPlanId(harness, 'starter');
    await plant(harness, subscriptions, { tenantId, planId, currentPeriodStart: new Date(), currentPeriodEnd: new Date(Date.now() + 864e5) });
    assert.equal((await onboardingOf(ctx)).current, 'connect');

    await plant(harness, storeConnections, { tenantId, provider: 'salla', externalStoreId: 'a-expired', status: 'expired' });
    assert.equal((await onboardingOf(ctx)).current, 'connect', 'an expired connection is not a connection');
    await plant(harness, storeConnections, { tenantId, provider: 'salla', externalStoreId: 'a-1', status: 'active' });
    assert.equal((await onboardingOf(ctx)).current, 'catalogue');

    await plant(harness, products, { tenantId, name: 'No size', dimensions: {} });
    await plant(harness, products, { tenantId, name: 'Width only', dimensions: { widthMm: 40 } });
    assert.equal((await onboardingOf(ctx)).current, 'catalogue', 'a product without width and height is not sized');
    await plant(harness, products, { tenantId, name: 'Oyster', dimensions: { widthMm: 41, heightMm: 48 } });
    assert.equal((await onboardingOf(ctx)).current, 'first_model');

    await plant(harness, models3d, { tenantId, name: 'draft', source: 'uploaded', status: 'processing' });
    assert.equal((await onboardingOf(ctx)).current, 'first_model');
    await plant(harness, models3d, { tenantId, name: 'ok', source: 'uploaded', status: 'ready' });
    assert.equal((await onboardingOf(ctx)).current, 'embed');

    await plant(harness, analyticsEvents, { tenantId, eventType: 'product_view', sessionId: 's', occurredAt: new Date() });
    const done = await onboardingOf(ctx);
    assert.equal(done.complete, true);
  } finally { await harness.close(); }
});

test('skips are recorded in the audit trail; a viewer cannot skip; bad skips are 422', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    await confirmStoreStep(ctx);
    const view = await skipStep(ctx, 'plan');
    assert.equal(view.current, 'connect');
    assert.equal((await unskipStep(ctx, 'plan')).current, 'plan');

    const trail = await harness.asAdmin(() => harness.db.select().from(auditLogs));
    assert.equal(trail.filter((r) => r.resourceType === 'onboarding').length, 3, 'confirm, skip and unskip — one row each');

    await assert.rejects(() => skipStep(ctx, 'catalogue'), (e: any) => e.code === 'validation_failed');

    const viewerId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: viewerId, email: 'v@example.test', passwordHash: 'x', fullName: 'v' } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId, userId: viewerId, role: 'viewer', status: 'active' } as any);
    });
    const viewer = await buildTenantContext({ actor: { userId: viewerId, email: 'v@example.test', isStaff: false }, tenantId, requestId: 'r' });
    await assert.rejects(() => skipStep(viewer, 'plan'), (e: any) => e.code === 'forbidden');
  } finally { await harness.close(); }
});

test('P1.2: the store address can be chosen while confirming — not once a storefront has reported, and not by a viewer', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'alpha');
    const other = await store(harness, 'bravo');
    await plant(harness, analyticsEvents, { tenantId: other.tenantId, eventType: 'product_view', sessionId: 's', occurredAt: new Date() });

    const viewerId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(users).values({ id: viewerId, email: 'v@example.test', passwordHash: 'x', fullName: 'v' } as any);
      await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId, userId: viewerId, role: 'viewer', status: 'active' } as any);
    });
    const viewer = await buildTenantContext({ actor: { userId: viewerId, email: 'v@example.test', isStaff: false }, tenantId, requestId: 'r' });
    await assert.rejects(() => confirmStoreStep(viewer, { slug: 'viewer-pick' }), (e: any) => e.code === 'forbidden');

    // Bravo's widget has reported a view from its storefront: its snippet carries the address.
    await assert.rejects(() => confirmStoreStep(other.ctx, { slug: 'bravo-new' }), (e: any) => e.code === 'validation_failed' && /fixed/.test(e.errors?.slug?.[0]));
    const same = await confirmStoreStep(other.ctx, { slug: other.ctx.tenant.slug });
    assert.equal(same.steps.find((s) => s.key === 'store')!.done, true, 'the same address is not a change');

    // Only another store has reported: alpha may still choose, and the answer says it is confirmed.
    const view = await confirmStoreStep(ctx, { slug: 'alpha-shop' });
    assert.equal(view.steps.find((s) => s.key === 'store')!.done, true);
    assert.equal(view.current, 'plan');
    const rows = await harness.asAdmin(() => harness.db.select().from(tenants));
    assert.equal(rows.find((r: any) => r.id === tenantId)!.slug, 'alpha-shop');
    await assert.rejects(() => confirmStoreStep(ctx, { slug: 'alpha-again' }), (e: any) => /fixed/.test(e.errors?.slug?.[0]), 'fixed once confirmed');
  } finally { await harness.close(); }
});
