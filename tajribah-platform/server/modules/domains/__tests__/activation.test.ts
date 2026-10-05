/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T62 — switching a store's own address on: the edge adapter against a stand-in Cloudflare zone, the
 * activation sweep, and what it changes for shoppers — the published config names the address, the
 * shop's widget opens the try-on there, and it stops the moment the address stops being the store's.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eq } from 'drizzle-orm';
import { auditLogs, customDomains, jobs, products, tryonConfigs } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { MemoryConfigStore, setConfigStore } from '@/server/core/edge/configs';
import { CloudflareCustomHostnames, setCustomHostnames } from '@/server/core/edge/custom-hostnames';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryStorage, setStorage } from '@/server/core/storage/storage';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { CF_TOKEN, CF_ZONE, CloudflareZone } from '@/server/testing/cloudflare-zone';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { WATCH_EVERY_MINUTES, activateCustomDomains, watchCustomDomains, watchSlot } from '@/server/modules/domains/activation';
import { checkCustomDomain, customDomain, removeCustomDomain, setCustomDomain } from '@/server/modules/domains/service';
import { handleEdgeJob, publishProduct } from '@/server/modules/edge/publish';
import { hostOf, parseConfig } from '@/widget/src/config';
import { DEFAULT_TRYON, tryOnBase, tryOnUrl } from '@/widget/src/tryon';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'https://app.tajribah.com', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });

class CdnStorage extends MemoryStorage {
  publicUrl(k: string) { return `https://cdn.example.test/${k}`; }
}

/** The DNS the merchant has set up: both records in place, or none. */
function dns(hostname: string, token: string | null) {
  return (async (input: any) => {
    const url = new URL(String(input));
    const name = url.searchParams.get('name')!;
    const type = url.searchParams.get('type')!;
    if (!token) return Response.json({ Status: 3 });
    if (type === 'TXT' && name === `_tajribah-verify.${hostname}`) return Response.json({ Status: 0, Answer: [{ name, type: 16, data: `"${token}"` }] });
    if (type === 'CNAME' && name === hostname) return Response.json({ Status: 0, Answer: [{ name, type: 5, data: 'domains.tajribah.com.' }] });
    return Response.json({ Status: 0 });
  }) as typeof fetch;
}

async function store(harness: TestDb, name: string, plan: 'pro' | 'enterprise' = 'enterprise') {
  setStorage(new CdnStorage());
  const kv = new MemoryConfigStore();
  setConfigStore(kv);
  const seeded = await seedTenant(harness, name, { plan });
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `r-${name}` });
  const [watch] = (await harness.asAdmin(() => harness.db.insert(products).values({
    tenantId: seeded.tenantId, name: 'Oyster 38', productType: 'watch', externalId: 'sa-1001', dimensions: { widthMm: 38, heightMm: 45 },
  } as any).returning())) as any[];
  await harness.asAdmin(() => harness.db.insert(tryonConfigs).values({
    id: uuidv7(), tenantId: seeded.tenantId, productId: watch.id, category: 'watch',
    wornKey: `t/${seeded.tenantId}/photo/${watch.id}/worn.webp`, wornBytes: 100, flatKey: `t/${seeded.tenantId}/photo/${watch.id}/flat.webp`, flatBytes: 100,
    caseTenthsMm: 380, enabled: true,
  } as any));
  await publishProduct(ctx, watch.id);
  return { ...seeded, ctx, kv, key: `${name}/sa-1001.json` };
}
const config = (kv: MemoryConfigStore, key: string) => JSON.parse(kv.entries.get(key)!.body);
const row = async (harness: TestDb, tenantId: string) => (await harness.asAdmin(() => harness.db.select().from(customDomains).where(eq(customDomains.tenantId, tenantId))) as any[])[0];
async function runRefresh(harness: TestDb) {
  const queued = await harness.asAdmin(() => harness.db.select().from(jobs).where(eq(jobs.queue, 'edge.publish-config'))) as any[];
  for (const job of queued) await handleEdgeJob(job);
  await harness.asAdmin(() => harness.db.delete(jobs).where(eq(jobs.queue, 'edge.publish-config')));
  return queued.length;
}
/** The store's address with both records in place: `ready`. */
async function ready(ctx: any, hostname: string) {
  const set = await setCustomDomain(ctx, hostname);
  const token = set.records[1]!.value;
  assert.equal((await checkCustomDomain(ctx, { fetch: dns(hostname, token) })).status, 'ready');
  return token;
}

test('the edge adapter against a stand-in Cloudflare zone: made once, read, active only with its certificate, removed', async () => {
  const zone = new CloudflareZone();
  const edge = new CloudflareCustomHostnames(CF_ZONE, CF_TOKEN, zone.fetch);
  const made = await edge.ensure('ar.bigco.sa');
  assert.deepEqual([made.active, typeof made.id, /ownership|records/.test(made.waitingFor ?? '')], [false, 'string', true]);
  assert.deepEqual(JSON.parse(JSON.stringify([...zone.hostnames.values()][0]!.ssl)), { status: 'pending_validation', method: 'http', type: 'dv' }, 'validated over HTTP through the CNAME — nothing more for the merchant to add');
  // Asked again (the first answer was lost): the same one, never two.
  assert.equal((await edge.ensure('ar.bigco.sa')).id, made.id);
  assert.equal(zone.hostnames.size, 1);
  // The hostname is active but its certificate is not yet: not serving.
  [...zone.hostnames.values()][0]!.status = 'active';
  assert.equal((await edge.get(made.id))!.active, false);
  zone.validate('ar.bigco.sa');
  assert.deepEqual(await edge.get(made.id), { id: made.id, active: true, waitingFor: null });

  await edge.remove(made.id);
  assert.equal(await edge.get(made.id), null, 'gone');
  await edge.remove(made.id); // already gone: fine

  // Our own token refused (the real API's 400 / 9106) and an outage: upstream errors — never "gone".
  const upstream = (e: any) => e.code?.startsWith('upstream_');
  await assert.rejects(() => new CloudflareCustomHostnames(CF_ZONE, 'wrong', zone.fetch).ensure('x.bigco.sa'),
    (e: any) => upstream(e) && /token was refused/.test(`${e.internal ?? ''} ${e.cause?.message ?? ''}`), 'said plainly, for whoever reads the log');
  await assert.rejects(() => new CloudflareCustomHostnames(CF_ZONE, 'wrong', zone.fetch).get(made.id), upstream);
  zone.down = true;
  await assert.rejects(() => edge.get(made.id), upstream);
  assert.equal(zone.hostnames.size, 0);
});

test('ready → asked at the edge → active: the config names the address and the shop opens the try-on there', async () => {
  const harness = await createTestDb();
  try {
    const zone = new CloudflareZone();
    const edge = new CloudflareCustomHostnames(CF_ZONE, CF_TOKEN, zone.fetch);
    setCustomHostnames(edge);
    const { ctx, tenantId, kv, key } = await store(harness, 'bigco');
    assert.equal(config(kv, key).host, null, 'no address yet');
    const token = await ready(ctx, 'ar.bigco.sa');

    // No edge configured: a ready address stays ready.
    assert.deepEqual(await activateCustomDomains(null), { asked: 0, active: 0, failed: 0 });

    // First pass: Cloudflare is asked; its checks have not passed yet.
    assert.deepEqual(await activateCustomDomains(edge), { asked: 1, active: 0, failed: 0 });
    assert.equal((await row(harness, tenantId)).status, 'ready');
    assert.ok((await row(harness, tenantId)).providerId, 'which hostname at the edge is remembered');
    // A pass while it waits asks for nothing new.
    assert.deepEqual(await activateCustomDomains(edge), { asked: 0, active: 0, failed: 0 });
    assert.equal(zone.hostnames.size, 1);
    assert.equal(await runRefresh(harness), 0, 'nothing changes for shoppers yet');

    // Cloudflare serves it: switched on, and the store's configs refreshed.
    zone.validate('ar.bigco.sa');
    assert.deepEqual(await activateCustomDomains(edge), { asked: 0, active: 1, failed: 0 });
    assert.equal((await customDomain(ctx))!.status, 'active');
    assert.equal(await runRefresh(harness), 1);
    const live = config(kv, key);
    assert.equal(live.host, 'ar.bigco.sa');
    const read = parseConfig(live)!;
    assert.equal(tryOnUrl(tryOnBase(DEFAULT_TRYON, read.host), 'bigco', 'sa-1001', 'ar'), 'https://ar.bigco.sa/embed/try-on?store=bigco&product=sa-1001&lang=ar');
    assert.deepEqual(await activateCustomDomains(edge), { asked: 0, active: 0, failed: 0 }, 'an active address is left alone');

    // The records are taken away: shoppers go back to Tajribah's address at once.
    assert.equal((await checkCustomDomain(ctx, { fetch: dns('ar.bigco.sa', null) })).status, 'pending');
    assert.equal(await runRefresh(harness), 1);
    assert.equal(config(kv, key).host, null);
    // …and back when they return (the edge still holds the name).
    assert.equal((await checkCustomDomain(ctx, { fetch: dns('ar.bigco.sa', token) })).status, 'ready');
    assert.deepEqual(await activateCustomDomains(edge), { asked: 0, active: 1, failed: 0 });
    await runRefresh(harness);
    assert.equal(config(kv, key).host, 'ar.bigco.sa');

    // Stop using it: out of the configs, and the edge stops serving the name.
    await removeCustomDomain(ctx);
    assert.equal(await runRefresh(harness), 1);
    assert.equal(config(kv, key).host, null);
    assert.equal(zone.hostnames.size, 0);
  } finally { setCustomHostnames(null); await harness.close(); }
});

test('not switched on: a store that left Enterprise; one failing address does not stop the others; a changed name retires the old one', async () => {
  const harness = await createTestDb();
  try {
    const zone = new CloudflareZone();
    const edge = new CloudflareCustomHostnames(CF_ZONE, CF_TOKEN, zone.fetch);
    setCustomHostnames(edge);
    const a = await store(harness, 'alpha');
    const b = await store(harness, 'beta');
    await ready(a.ctx, 'ar.alpha.sa');
    await ready(b.ctx, 'ar.beta.sa');
    // Alpha's address cannot be made at the edge (Cloudflare refuses it); beta's still is.
    const refusing = { ...edge, ensure: async (h: string) => { if (h === 'ar.alpha.sa') throw new Error('refused'); return edge.ensure(h); }, get: (id: string) => edge.get(id), remove: (id: string) => edge.remove(id) };
    assert.deepEqual(await activateCustomDomains(refusing), { asked: 1, active: 0, failed: 1 });
    assert.deepEqual([...zone.hostnames.values()].map((h) => h.hostname), ['ar.beta.sa']);

    // Beta leaves Enterprise before Cloudflare finishes: never switched on, and its config never names the address.
    zone.validate('ar.beta.sa');
    const { plans, subscriptions } = await import('@/db/schema');
    const [pro] = await harness.asAdmin(() => harness.db.select({ id: plans.id }).from(plans).where(eq(plans.code, 'pro'))) as any[];
    await harness.asAdmin(() => harness.db.update(subscriptions).set({ planId: pro.id } as any).where(eq(subscriptions.tenantId, b.tenantId)));
    assert.deepEqual(await activateCustomDomains(edge), { asked: 1, active: 0, failed: 0 }, 'alpha asked now; beta skipped');
    assert.equal((await row(harness, b.tenantId)).status, 'ready');

    // Alpha changes its name while the old one is at the edge: the old hostname is removed there.
    assert.ok([...zone.hostnames.values()].some((h) => h.hostname === 'ar.alpha.sa'));
    await setCustomDomain(a.ctx, 'try.alpha.sa');
    assert.ok(![...zone.hostnames.values()].some((h) => h.hostname === 'ar.alpha.sa'));
    assert.equal((await row(harness, a.tenantId)).providerId, null);
  } finally { setCustomHostnames(null); await harness.close(); }
});

test('the widget reads only a plain hostname; the shop script’s own address wins over it', () => {
  for (const good of ['ar.bigco.sa', 'try-on.shop.example.com', 'xn--wgbkh.xn--pgbep1f2a.com']) assert.equal(hostOf(good), good);
  for (const bad of ['bigco.sa', 'https://ar.bigco.sa', 'ar.bigco.sa/x', 'ar.bigco.sa:8443', 'AR.bigco.sa', '-ar.bigco.sa', 'ar.bigco.sa.', '10.0.0.1', 'aXbigcoXsa', 'ar bigco.sa', '', null, 7, { host: 'x' }]) assert.equal(hostOf(bad), null, String(bad));
  assert.equal(tryOnBase(DEFAULT_TRYON, null), DEFAULT_TRYON);
  assert.equal(tryOnBase(DEFAULT_TRYON, 'ar.bigco.sa'), 'https://ar.bigco.sa/embed/try-on');
  assert.equal(tryOnBase('http://localhost:5173/embed/try-on', 'ar.bigco.sa'), 'http://localhost:5173/embed/try-on', 'a test or preview address named by the script stays');
});

/** A time in the address's own minute of the quarter-hour (and one that is not). */
function minuteFor(id: string, offset = 0) {
  const base = Date.UTC(2026, 9, 1, 12, 0, 0);
  return new Date(base + ((watchSlot(id) + offset) % WATCH_EVERY_MINUTES) * 60_000);
}

test('the watch: records added are noticed without "Check now"; records removed take a live address away from shoppers within the quarter-hour', async () => {
  const harness = await createTestDb();
  try {
    const zone = new CloudflareZone();
    const edge = new CloudflareCustomHostnames(CF_ZONE, CF_TOKEN, zone.fetch);
    setCustomHostnames(edge);
    const { ctx, tenantId, kv, key } = await store(harness, 'bigco');
    const set = await setCustomDomain(ctx, 'ar.bigco.sa');
    const token = set.records[1]!.value;
    const { id } = await row(harness, tenantId);
    assert.ok(watchSlot(id) >= 0 && watchSlot(id) < WATCH_EVERY_MINUTES && watchSlot(id) === watchSlot(id));
    const audits = async () => (await harness.asAdmin(() => harness.db.select().from(auditLogs)) as any[]).filter((a) => a.resourceType === 'custom_domain').length;

    // Not its minute: not looked at.
    assert.deepEqual(await watchCustomDomains({ edge, fetch: dns('ar.bigco.sa', token), now: minuteFor(id, 1) }), { looked: 0, changed: 0, failed: 0 });
    // Its minute, nothing added yet: looked at, nothing written.
    const before = await audits();
    assert.deepEqual(await watchCustomDomains({ edge, fetch: dns('ar.bigco.sa', null), now: minuteFor(id) }), { looked: 1, changed: 0, failed: 0 });
    assert.deepEqual([(await row(harness, tenantId)).checkedAt, await audits()], [null, before], 'the same standing writes nothing');
    // The merchant added both records and walked away: ready on the next look.
    assert.deepEqual(await watchCustomDomains({ edge, fetch: dns('ar.bigco.sa', token), now: minuteFor(id) }), { looked: 1, changed: 1, failed: 0 });
    assert.equal((await row(harness, tenantId)).status, 'ready');
    assert.equal(await audits(), before + 1, 'a change of standing is on the trail');

    // Asked for at the edge, still waiting there — and the records are taken away: pending, whatever the edge says.
    await activateCustomDomains(edge);
    assert.deepEqual(await watchCustomDomains({ edge, fetch: dns('ar.bigco.sa', null), now: minuteFor(id) }), { looked: 1, changed: 1, failed: 0 });
    assert.equal((await row(harness, tenantId)).status, 'pending');
    await watchCustomDomains({ edge, fetch: dns('ar.bigco.sa', token), now: minuteFor(id) });
    assert.equal((await row(harness, tenantId)).status, 'ready');

    // Switched on.
    await activateCustomDomains(edge);
    zone.validate('ar.bigco.sa');
    await activateCustomDomains(edge);
    await runRefresh(harness);
    assert.equal(config(kv, key).host, 'ar.bigco.sa');

    // The resolver is down: not a reason to take anything away.
    const failing = (async () => Response.json({ Status: 2 })) as typeof fetch;
    assert.deepEqual(await watchCustomDomains({ edge, fetch: failing, now: minuteFor(id) }), { looked: 1, changed: 0, failed: 1 });
    assert.equal((await row(harness, tenantId)).status, 'active');

    // The edge stops serving it (the hostname is gone there) though the records stand: asked for again.
    zone.hostnames.clear();
    assert.deepEqual(await watchCustomDomains({ edge, fetch: dns('ar.bigco.sa', token), now: minuteFor(id) }), { looked: 1, changed: 1, failed: 0 });
    assert.deepEqual([(await row(harness, tenantId)).status, (await row(harness, tenantId)).providerId], ['ready', null]);
    assert.equal(await runRefresh(harness), 1);
    assert.equal(config(kv, key).host, null, 'shoppers are not sent to an address nobody serves');
    await activateCustomDomains(edge);
    zone.validate('ar.bigco.sa');
    await activateCustomDomains(edge);
    await runRefresh(harness);
    assert.equal(config(kv, key).host, 'ar.bigco.sa');

    // The merchant removes the records and tells no one: noticed, and shoppers go back to Tajribah's address.
    assert.deepEqual(await watchCustomDomains({ edge, fetch: dns('ar.bigco.sa', null), now: minuteFor(id) }), { looked: 1, changed: 1, failed: 0 });
    assert.equal((await row(harness, tenantId)).status, 'pending');
    assert.equal(await runRefresh(harness), 1);
    assert.equal(config(kv, key).host, null);
  } finally { setCustomHostnames(null); await harness.close(); }
});
