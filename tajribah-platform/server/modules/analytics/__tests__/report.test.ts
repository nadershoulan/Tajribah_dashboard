/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P4.8 — the weekly summary by email: a member's own choice (never sent unasked), for those who may
 * export on a plan with full analytics and a confirmed address; the Sunday-to-Saturday week in Riyadh,
 * sent from Sunday 08:00, once; the store's own figures beside the week before; and everything
 * checked again each week.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { and, eq } from 'drizzle-orm';
import { auditLogs, conversionDaily, dailyTenantStats, products, reportSubscriptions, subscriptions, tenantMemberships, tenants, users } from '@/db/schema';
import { formatDate } from '@/lib/format';
import { uuidv7 } from '@/lib/ids';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { setEmailSender, type EmailMessage } from '@/server/core/notify/notify';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { reportLines, reportSubscription, reportWeek, sendWeeklyReports, setReportSubscription } from '@/server/modules/analytics/report';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'https://app.tajribah.sa', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });

// 2026-10-04 is a Sunday. 08:00 in Riyadh is 05:00 UTC.
const WEDNESDAY = new Date('2026-09-30T09:00:00Z');
const SUNDAY_0759 = new Date('2026-10-04T04:59:00Z');
const SUNDAY_0800 = new Date('2026-10-04T05:00:00Z');
const TUESDAY = new Date('2026-10-06T10:00:00Z');
const NEXT_SUNDAY = new Date('2026-10-11T06:00:00Z');

function outbox() {
  const sent: EmailMessage[] = [];
  setEmailSender({ async send(message) { sent.push(message); } });
  return sent;
}

async function store(harness: TestDb, name: string, plan: 'starter' | 'growth' | 'pro' = 'growth', confirmed = true) {
  const seeded = await seedTenant(harness, name, { plan });
  if (confirmed) await harness.asAdmin(() => harness.db.update(users).set({ emailVerifiedAt: new Date() } as any).where(eq(users.id, seeded.userId)));
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `r-${name}` });
  return { ...seeded, ctx };
}

async function member(harness: TestDb, tenantId: string, name: string, role: string, locale: 'ar' | 'en' = 'ar') {
  const userId = uuidv7();
  const email = `${name}@example.test`;
  await harness.asAdmin(async () => {
    await harness.db.insert(users).values({ id: userId, email, passwordHash: 'pbkdf2$sha256$1$x$x', fullName: name, locale, emailVerifiedAt: new Date() } as any);
    await harness.db.insert(tenantMemberships).values({ id: uuidv7(), tenantId, userId, role, status: 'active' } as any);
  });
  const ctx = await buildTenantContext({ actor: { userId, email, isStaff: false }, tenantId, requestId: `r-${name}` });
  return { userId, email, ctx };
}

const day = (tenantId: string, d: string, n: number, revenueMinor = n * 1000) =>
  ({ tenantId, day: d, views: n * 10, arSessions: n * 3, tryonSessions: n * 2, addToCart: n, purchases: n, revenueMinor, uniqueSessions: n * 9 });

const rows = (harness: TestDb) => harness.asAdmin(() => harness.db.select().from(reportSubscriptions));

test('which week: Sunday to Saturday in Riyadh, from Sunday 08:00', () => {
  const week = { from: '2026-09-27', to: '2026-10-03', before: { from: '2026-09-20', to: '2026-09-26' }, nextOn: '2026-10-11' };
  assert.deepEqual(reportWeek(SUNDAY_0800), week, 'at 08:00 on Sunday the week that just ended');
  assert.deepEqual(reportWeek(TUESDAY), week, 'and the same week for the rest of it — a late pass still sends it');
  assert.deepEqual(reportWeek(new Date('2026-10-11T04:59:59Z')), week, 'until a second before the next Sunday 08:00');
  assert.deepEqual(reportWeek(SUNDAY_0759), { from: '2026-09-20', to: '2026-09-26', before: { from: '2026-09-13', to: '2026-09-19' }, nextOn: '2026-10-04' },
    'a minute before 08:00 it is still the week before; the next one is today');
  assert.equal(reportWeek(new Date('2026-10-03T21:30:00Z')).nextOn, '2026-10-04', '00:30 on Sunday in Riyadh is still Saturday in UTC: Riyadh decides');
  assert.equal(reportWeek(new Date('2027-01-01T12:00:00Z')).from, '2026-12-20', 'across a year end');
});

test('a member turns it on for themselves; the first summary is the next Sunday’s, with the store’s figures beside the week before — once', async () => {
  const harness = await createTestDb();
  const sent = outbox();
  try {
    const shop = await store(harness, 'oud');
    const other = await store(harness, 'pearl');
    const analyst = await member(harness, shop.tenantId, 'analyst', 'analyst', 'en');
    await member(harness, shop.tenantId, 'quiet', 'admin'); // may export, never asked: gets nothing
    await harness.asAdmin(async () => {
      await harness.db.update(tenants).set({ name: 'عود' } as any).where(eq(tenants.id, shop.tenantId));
      await harness.db.insert(dailyTenantStats).values([
        day(shop.tenantId, '2026-09-27', 10), day(shop.tenantId, '2026-10-03', 5, 123_456), // the week: its first and last day
        day(shop.tenantId, '2026-09-20', 2), day(shop.tenantId, '2026-09-26', 1), // the week before: its first and last day
        day(shop.tenantId, '2026-09-19', 500), day(shop.tenantId, '2026-10-04', 700), // either side: in neither
        day(other.tenantId, '2026-09-30', 900), // another store's
      ] as any);
    });

    assert.deepEqual(await reportSubscription(shop.ctx, WEDNESDAY), { weekly: false, email: 'oud@example.test', unavailable: null, nextOn: '2026-10-04' }, 'off until asked for');
    assert.deepEqual(await sendWeeklyReports(SUNDAY_0800), { sent: 0, skipped: 0 }, 'nobody asked: nobody is written to');

    const on = await setReportSubscription(shop.ctx, true, WEDNESDAY);
    assert.deepEqual(on, { weekly: true, email: 'oud@example.test', unavailable: null, nextOn: '2026-10-04' });
    await setReportSubscription(shop.ctx, true, WEDNESDAY); // again: still one
    await setReportSubscription(analyst.ctx, true, WEDNESDAY);
    const made = await rows(harness);
    assert.equal(made.length, 2, 'one row per member');
    assert.ok(made.every((r) => r.lastSentFor === '2026-09-26'), 'the week already ended counts as handled');
    const trail = await harness.asAdmin(() => harness.db.select().from(auditLogs).where(eq(auditLogs.resourceType, 'report_subscription')));
    assert.deepEqual(trail.map((r) => [r.action, r.actorUserId]).sort(), [['create', analyst.userId], ['create', shop.userId]].sort(), 'each choice is on the trail, by the member who made it');

    assert.deepEqual(await sendWeeklyReports(WEDNESDAY), { sent: 0, skipped: 0 }, 'not the moment it is turned on');
    assert.deepEqual(await sendWeeklyReports(SUNDAY_0759), { sent: 0, skipped: 0 }, 'not before 08:00 on Sunday');
    // Two passes at the same moment (the minute's cron and a queue pass): each summary still goes out once.
    const passes = await Promise.all([sendWeeklyReports(SUNDAY_0800), sendWeeklyReports(SUNDAY_0800)]);
    assert.equal(passes[0].sent + passes[1].sent, 2);
    assert.equal(sent.length, 2, 'whoever claims the week sends it; the other pass finds nothing');
    assert.deepEqual(await sendWeeklyReports(SUNDAY_0800), { sent: 0, skipped: 0 }, 'the week is sent once');
    assert.deepEqual(await sendWeeklyReports(TUESDAY), { sent: 0, skipped: 0 });
    assert.deepEqual(sent.map((m) => m.to).sort(), ['analyst@example.test', 'oud@example.test']);

    const ar = sent.find((m) => m.to === 'oud@example.test')!;
    assert.equal(ar.lang, 'ar');
    assert.equal(ar.subject, 'ملخص الأسبوع — عود');
    assert.equal(ar.text, [
      'مرحباً،', '',
      'ملخص متجر «عود» من 27 سبتمبر 2026 إلى 3 أكتوبر 2026:', '',
      'مشاهدات المنتجات: 150 (الأسبوع الذي قبله: 30)',
      'جلسات العرض: 45 (الأسبوع الذي قبله: 9)',
      'تجارب افتراضية: 30 (الأسبوع الذي قبله: 6)',
      'إضافات إلى السلة: 15 (الأسبوع الذي قبله: 3)',
      'عمليات شراء: 15 (الأسبوع الذي قبله: 3)',
      `إيراد المشتريات المسجّلة: ${'1,334.56'} ر.س (الأسبوع الذي قبله: ${'30.00'} ر.س)`, '',
      'التفاصيل في صفحة التحليلات:', 'https://app.tajribah.sa/dashboard/analytics', '',
      'تصلك هذه الرسالة كل أحد لأنك فعّلت الملخص الأسبوعي في تجربة. لإيقافها افتح صفحة التحليلات وأوقف «ملخص أسبوعي بالبريد».',
    ].join('\n'));
    const en = sent.find((m) => m.to === 'analyst@example.test')!;
    assert.equal(en.lang, 'en');
    assert.equal(en.subject, 'Your week — عود');
    // The month's short name is the runtime's (`Sep` or `Sept`): the same formatter the screens use.
    assert.ok(en.text.includes(`"عود", ${formatDate('2026-09-27T12:00:00Z', 'en')} to ${formatDate('2026-10-03T12:00:00Z', 'en')}:\n\nProduct views: 150 (week before: 30)\n`), en.text);
    assert.match(en.text, /"عود", 27 Sept? 2026 to 3 Oct 2026:/);
    assert.ok(en.text.includes('Tracked revenue: SAR 1,334.56 (week before: SAR 30.00)\n\nThe detail is on the Analytics page:\nhttps://app.tajribah.sa/dashboard/analytics\n'), en.text);
    assert.ok(!/uplift|ارتفاع/i.test(ar.text + en.text), 'no uplift line without a sample to state one from');

    // The week after: the next one, with that week's own figures.
    sent.length = 0;
    assert.deepEqual(await sendWeeklyReports(NEXT_SUNDAY), { sent: 2, skipped: 0 });
    assert.ok(sent[0]!.text.includes(': 7,000 ('), 'the day that was after last week is in this one');
    assert.ok((await rows(harness)).every((r) => r.lastSentFor === '2026-10-10'));

    // Turned off: the row is gone, on the trail, and nothing more arrives. The other member's stays.
    assert.equal((await setReportSubscription(shop.ctx, false, NEXT_SUNDAY)).weekly, false);
    await setReportSubscription(shop.ctx, false, NEXT_SUNDAY); // again: nothing to do
    assert.deepEqual((await rows(harness)).map((r) => r.userId), [analyst.userId]);
    assert.equal((await harness.asAdmin(() => harness.db.select().from(auditLogs).where(and(eq(auditLogs.resourceType, 'report_subscription'), eq(auditLogs.action, 'delete'))))).length, 1);
    sent.length = 0;
    assert.deepEqual(await sendWeeklyReports(new Date('2026-10-18T06:00:00Z')), { sent: 1, skipped: 0 });
    assert.deepEqual(sent.map((m) => m.to), ['analyst@example.test']);
  } finally { await harness.close(); }
});

test('who may: export permission, full analytics, a confirmed address — and only a member, for themselves', async () => {
  const harness = await createTestDb();
  outbox();
  try {
    const shop = await store(harness, 'oud');
    const starter = await store(harness, 'small', 'starter');
    const unconfirmed = await store(harness, 'new', 'growth', false);
    const viewer = await member(harness, shop.tenantId, 'viewer', 'viewer');

    assert.equal((await reportSubscription(viewer.ctx, WEDNESDAY)).unavailable, 'role');
    await assert.rejects(setReportSubscription(viewer.ctx, true, WEDNESDAY), (e: any) => e.code === 'forbidden');
    assert.equal((await reportSubscription(starter.ctx, WEDNESDAY)).unavailable, 'plan');
    await assert.rejects(setReportSubscription(starter.ctx, true, WEDNESDAY), (e: any) => e.code === 'plan_required');
    assert.equal((await reportSubscription(unconfirmed.ctx, WEDNESDAY)).unavailable, 'email');
    await assert.rejects(setReportSubscription(unconfirmed.ctx, true, WEDNESDAY), (e: any) => e.code === 'forbidden' && /confirm your email/.test(e.message));

    // Not a member acting: staff looking at the store, a key, background work.
    for (const actorType of ['staff', 'api_key', 'system'] as const) {
      const ctx = { ...shop.ctx, actorType };
      assert.deepEqual([(await reportSubscription(ctx, WEDNESDAY)).weekly, (await reportSubscription(ctx, WEDNESDAY)).unavailable], [false, 'role'], actorType);
      await assert.rejects(setReportSubscription(ctx, true, WEDNESDAY), (e: any) => e.code === 'forbidden', actorType);
      await assert.rejects(setReportSubscription(ctx, false, WEDNESDAY), (e: any) => e.code === 'forbidden', actorType);
    }
    const staff = { ...shop.ctx, actor: { ...shop.ctx.actor, isStaff: true } };
    await assert.rejects(setReportSubscription(staff, true, WEDNESDAY), (e: any) => e.code === 'forbidden');
    assert.equal((await rows(harness)).length, 0, 'nothing was made by any of them');

    // One member's choice is theirs: another member of the same store sees their own (off).
    await setReportSubscription(shop.ctx, true, WEDNESDAY);
    assert.equal((await reportSubscription({ ...shop.ctx, actorType: 'api_key' }, WEDNESDAY)).weekly, false, 'a key acts as its maker, but the maker’s choice is not the key’s to read');
    const admin = await member(harness, shop.tenantId, 'admin', 'admin');
    assert.equal((await reportSubscription(admin.ctx, WEDNESDAY)).weekly, false);
    await setReportSubscription(admin.ctx, false, WEDNESDAY);
    assert.equal((await rows(harness)).length, 1, 'and turning one’s own off leaves the other’s alone');
  } finally { await harness.close(); }
});

test('checked again each week: no longer allowed gets nothing — and the choice works again when the reason is gone', async () => {
  const harness = await createTestDb();
  const sent = outbox();
  try {
    const shop = await store(harness, 'oud');
    const demoted = await member(harness, shop.tenantId, 'demoted', 'analyst');
    const left = await member(harness, shop.tenantId, 'left', 'admin');
    const second = await store(harness, 'second');
    const downgraded = await store(harness, 'downgraded');
    const held = await store(harness, 'held');
    const unconfirmed = await member(harness, shop.tenantId, 'unconfirmed', 'admin');
    for (const ctx of [shop.ctx, demoted.ctx, left.ctx, second.ctx, held.ctx, unconfirmed.ctx, downgraded.ctx]) await setReportSubscription(ctx, true, WEDNESDAY);

    await harness.asAdmin(async () => {
      await harness.db.update(tenantMemberships).set({ role: 'viewer' } as any).where(eq(tenantMemberships.userId, demoted.userId));
      await harness.db.update(tenantMemberships).set({ status: 'suspended' } as any).where(eq(tenantMemberships.userId, left.userId));
      await harness.db.update(tenants).set({ status: 'suspended' } as any).where(eq(tenants.id, held.tenantId));
      await harness.db.update(users).set({ emailVerifiedAt: null } as any).where(eq(users.id, unconfirmed.userId));
      await harness.db.delete(subscriptions).where(eq(subscriptions.tenantId, downgraded.tenantId)); // no subscription: Starter, without full analytics
    });

    assert.deepEqual(await sendWeeklyReports(SUNDAY_0800), { sent: 2, skipped: 5 });
    assert.deepEqual(sent.map((m) => m.to).sort(), ['oud@example.test', 'second@example.test']);
    assert.deepEqual(await sendWeeklyReports(TUESDAY), { sent: 0, skipped: 0 }, 'a skipped week is handled too: not looked at again every minute');
    assert.equal((await rows(harness)).length, 7, 'the choices stay');
    assert.equal((await reportSubscription(await buildTenantContext({ actor: { userId: demoted.userId, email: demoted.email, isStaff: false }, tenantId: shop.tenantId, requestId: 'r' }), TUESDAY)).weekly, true,
      'a demoted member still sees theirs on (and why it is paused)');

    // The role back, the store released: those two are written to again; the rest still are not.
    await harness.asAdmin(async () => {
      await harness.db.update(tenantMemberships).set({ role: 'analyst' } as any).where(eq(tenantMemberships.userId, demoted.userId));
      await harness.db.update(tenants).set({ status: 'active' } as any).where(eq(tenants.id, held.tenantId));
    });
    sent.length = 0;
    const next = await sendWeeklyReports(NEXT_SUNDAY);
    assert.deepEqual(sent.map((m) => m.to).sort(), ['demoted@example.test', 'held@example.test', 'oud@example.test', 'second@example.test'], 'allowed again: sent again');
    assert.deepEqual(next, { sent: 4, skipped: 3 });
  } finally { await harness.close(); }
});

test('a read-only store gets no summary; an email that fails is not sent twice; one bad store does not stop the rest', async () => {
  const harness = await createTestDb();
  try {
    const good = await store(harness, 'good');
    const ended = await seedTenant(harness, 'ended'); // no subscription: a trial, about to end
    await harness.asAdmin(async () => {
      await harness.db.update(users).set({ emailVerifiedAt: new Date() } as any).where(eq(users.id, ended.userId));
      await harness.db.update(tenants).set({ status: 'trial', trialEndsAt: new Date(Date.now() + 86_400_000) } as any).where(eq(tenants.id, ended.tenantId));
    });
    const endedCtx = await buildTenantContext({ actor: { userId: ended.userId, email: ended.email, isStaff: false }, tenantId: ended.tenantId, requestId: 'r-ended' });
    assert.equal((await setReportSubscription(endedCtx, true, WEDNESDAY)).weekly, true, 'a trial has full analytics');
    await setReportSubscription(good.ctx, true, WEDNESDAY);
    await harness.asAdmin(() => harness.db.update(tenants).set({ trialEndsAt: new Date(Date.now() - 86_400_000) } as any).where(eq(tenants.id, ended.tenantId)));

    const tried: string[] = [];
    setEmailSender({ async send(message) { tried.push(message.to); throw new Error('the mail provider is down'); } });
    assert.deepEqual(await sendWeeklyReports(SUNDAY_0800), { sent: 0, skipped: 2 });
    assert.deepEqual(tried, ['good@example.test'], 'the read-only store was not written to');
    assert.deepEqual(await sendWeeklyReports(TUESDAY), { sent: 0, skipped: 0 }, 'the failed one is logged, not sent again');
    assert.deepEqual(tried, ['good@example.test']);
  } finally { await harness.close(); }
});

test('the uplift line appears only when both groups are large enough, signed either way', async () => {
  const harness = await createTestDb();
  const sent = outbox();
  try {
    const shop = await store(harness, 'oud');
    const productId = uuidv7();
    await harness.asAdmin(async () => {
      await harness.db.insert(products).values({ id: productId, tenantId: shop.tenantId, name: 'Oud 41' } as any);
      await harness.db.insert(conversionDaily).values([
        { tenantId: shop.tenantId, productId, day: '2026-09-28', sessionsWithAr: 200, purchasesWithAr: 20, sessionsWithoutAr: 1000, purchasesWithoutAr: 50 },
        { tenantId: shop.tenantId, productId, day: '2026-09-26', sessionsWithAr: 5000, purchasesWithAr: 0, sessionsWithoutAr: 10, purchasesWithoutAr: 10 }, // the week before: not this week's
      ] as any);
    });
    await setReportSubscription(shop.ctx, true, WEDNESDAY);
    await sendWeeklyReports(SUNDAY_0800);
    assert.ok(sent[0]!.text.includes('\nارتفاع التحويل (نسبة الشراء لمن فتح العرض ناقص من لم يفتحه): ⁦+5.0⁩ نقطة\n\n'), sent[0]!.text);

    const zero = { views: 0, arSessions: 0, tryonSessions: 0, addToCart: 0, purchases: 0, revenueMinor: 0 };
    assert.ok(reportLines({ week: zero, before: zero, upliftPct: -0.021 }, 'en').endsWith('Conversion uplift (purchase rate with AR minus without): −2.1 pts'), 'a worse week is said as worse');
    assert.equal(reportLines({ week: zero, before: zero, upliftPct: null }, 'en').split('\n').length, 6, 'and no line at all without one');
    assert.ok(reportLines({ week: zero, before: zero, upliftPct: null }, 'ar').startsWith('مشاهدات المنتجات: 0 (الأسبوع الذي قبله: 0)'), 'a quiet week is zeros, not a missing mail');
  } finally { await harness.close(); }
});
