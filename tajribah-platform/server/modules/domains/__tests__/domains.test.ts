/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T62 — an Enterprise store's own address: which names are accepted, one store per name, and the two
 * DNS records checked over DNS-over-HTTPS. The resolver answers below are the shapes Cloudflare's
 * resolver was seen to return on 2026-10-01 (quoted TXT values, CNAME targets with the root's dot,
 * Status 3 for a name that does not exist, no Answer for a type that has no record).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { auditLogs, customDomains } from '@/db/schema';
import { loadEnv, resetEnv } from '@/server/core/config/env';
import { lookup, txtValue } from '@/server/core/dns/doh';
import { setLogLevel } from '@/server/core/observability/log';
import { buildTenantContext } from '@/server/core/tenancy/context';
import { createTestDb, seedTenant, type TestDb } from '@/server/testing/harness';
import { DEFAULT_TARGET, checkCustomDomain, customDomain, hostnameOf, removeCustomDomain, setCustomDomain } from '@/server/modules/domains/service';

setLogLevel('error');
resetEnv();
loadEnv({ APP_URL: 'https://app.tajribah.org', AUTH_SECRET: 's'.repeat(40), ENCRYPTION_KEY: 'e'.repeat(40) });

/** A stand-in resolver: the records the merchant has added so far. */
function resolver(records: { txt?: Record<string, string[]>; cname?: Record<string, string> } = {}, status = 0) {
  const asked: string[] = [];
  const f = (async (input: any) => {
    const url = new URL(String(input));
    const name = url.searchParams.get('name')!;
    const type = url.searchParams.get('type')!;
    asked.push(`${type} ${name}`);
    if (status !== 0) return Response.json({ Status: status });
    const txt = records.txt?.[name];
    const cname = records.cname?.[name];
    if (!txt && !cname) return Response.json({ Status: 3, Question: [{ name, type: 16 }] });
    const Answer = type === 'TXT' ? (txt ?? []).map((v) => ({ name, type: 16, TTL: 300, data: `"${v}"` })) : cname ? [{ name, type: 5, TTL: 3600, data: `${cname}.` }] : undefined;
    return Response.json({ Status: 0, ...(Answer?.length ? { Answer } : {}) });
  }) as typeof fetch;
  return Object.assign(f, { asked });
}

async function store(harness: TestDb, name: string, plan: 'pro' | 'enterprise' = 'enterprise') {
  const seeded = await seedTenant(harness, name, { plan });
  const ctx = await buildTenantContext({ actor: { userId: seeded.userId, email: seeded.email, isStaff: false }, tenantId: seeded.tenantId, requestId: `r-${name}` });
  return { ...seeded, ctx };
}

test('which names are accepted: a subdomain of the store’s own, in its ASCII form', () => {
  assert.equal(hostnameOf('  https://AR.TheirStore.com/any/path?x=1 '), 'ar.theirstore.com');
  assert.equal(hostnameOf('ar.theirstore.com.'), 'ar.theirstore.com');
  assert.equal(hostnameOf('عرض.متجري.com'), 'xn--wgbkh.xn--pgbep1f2a.com', 'an Arabic name, as DNS holds it (checked against Python’s IDNA codec)');
  const refused = (input: string) => assert.throws(() => hostnameOf(input), (e: any) => e.code === 'validation_failed', input);
  for (const bad of ['theirstore.com', 'localhost', 'ar.tajribah.org', 'tajribah.org', 'x.y.tajribah.org', '10.0.0.1', '1.2.3.4', 'ar.store.com:8443', 'user@ar.store.com', '-bad.store.com', 'a..b.com', `${'a'.repeat(64)}.store.com`, 'ar.shop.localhost', '']) refused(bad);
});

test('the resolver’s answers, as the real one gives them', async () => {
  assert.equal(txtValue('"v=DMARC1; p=reject; rua=mailto:mailauth-reports@google.com"'), 'v=DMARC1; p=reject; rua=mailto:mailauth-reports@google.com');
  assert.equal(txtValue('"v=spf1 " "include:_spf.example.com ~all"'), 'v=spf1 include:_spf.example.com ~all', 'a long value split in two');
  const f = resolver({ txt: { 'a.b.com': ['one', 'two'] }, cname: { 'www.b.com': 'Target.Example.NET' } });
  assert.deepEqual(await lookup('a.b.com', 'TXT', f), ['one', 'two']);
  assert.deepEqual(await lookup('www.b.com', 'CNAME', f), ['target.example.net'], 'the root’s dot gone, lower case');
  assert.deepEqual(await lookup('nothing.b.com', 'TXT', f), [], 'NXDOMAIN: not there yet');
  assert.deepEqual(await lookup('a.b.com', 'CNAME', f), [], 'no record of that type');
  await assert.rejects(() => lookup('a.b.com', 'TXT', resolver({}, 2)), (e: any) => e.code?.startsWith('upstream_'), 'SERVFAIL: we could not look — not "absent"');
  await assert.rejects(() => lookup('a.b.com', 'TXT', (async () => { throw new Error('offline'); }) as typeof fetch), (e: any) => e.code?.startsWith('upstream_'));
});

test('set, check, and the four standings: pending → verified → ready; another store cannot take the name', async () => {
  const harness = await createTestDb();
  try {
    const { ctx, tenantId } = await store(harness, 'bigco');
    assert.equal(await customDomain(ctx), null);
    const set = await setCustomDomain(ctx, 'AR.BigCo.sa');
    assert.equal(set.hostname, 'ar.bigco.sa');
    assert.equal(set.status, 'pending');
    const [cname, txt] = set.records;
    assert.deepEqual([cname!.type, cname!.name, cname!.value], ['CNAME', 'ar.bigco.sa', DEFAULT_TARGET]);
    assert.deepEqual([txt!.type, txt!.name], ['TXT', '_tajribah-verify.ar.bigco.sa']);
    assert.match(txt!.value, /^tajribah-verification=[0-9a-f]{32}$/);

    // Nothing added yet.
    let view = await checkCustomDomain(ctx, { fetch: resolver() });
    assert.deepEqual([view.status, view.records.map((r) => r.seen)], ['pending', [false, false]]);
    // Someone else's token in the TXT record proves nothing.
    view = await checkCustomDomain(ctx, { fetch: resolver({ txt: { '_tajribah-verify.ar.bigco.sa': ['tajribah-verification=0000'] } }) });
    assert.equal(view.status, 'pending');
    // The TXT record: the name is the store's; the CNAME still points at the old host.
    const verifiedAt = new Date('2026-10-01T09:00:00Z');
    view = await checkCustomDomain(ctx, { fetch: resolver({ txt: { '_tajribah-verify.ar.bigco.sa': ['google-site-verification=x', txt!.value] }, cname: { 'ar.bigco.sa': 'old-host.example.com' } }), now: verifiedAt });
    assert.deepEqual([view.status, view.pointsTo, view.verifiedAt], ['verified', 'old-host.example.com', verifiedAt.toISOString()]);
    // Both: ready — waiting for Tajribah to switch it on.
    view = await checkCustomDomain(ctx, { fetch: resolver({ txt: { '_tajribah-verify.ar.bigco.sa': [txt!.value] }, cname: { 'ar.bigco.sa': 'domains.tajribah.org' } }), now: new Date('2026-10-01T10:00:00Z') });
    assert.deepEqual([view.status, view.records.map((r) => r.seen), view.verifiedAt], ['ready', [true, true], verifiedAt.toISOString()], 'proven once, the first time stays');

    // Saving the same name again (another spelling of it) keeps its token and standing — the records already added still count.
    const again = await setCustomDomain(ctx, 'https://ar.BIGCO.sa/');
    assert.deepEqual([again.status, again.records[1]!.value], ['ready', txt!.value]);

    // Another store claiming the same name: refused, and it cannot see whose it is.
    const other = await store(harness, 'rival');
    await assert.rejects(() => setCustomDomain(other.ctx, 'ar.bigco.sa'), (e: any) => e.code === 'conflict');

    // A different name starts over: a new token, pending.
    const changed = await setCustomDomain(ctx, 'try.bigco.sa');
    assert.equal(changed.status, 'pending');
    assert.notEqual(changed.records[1]!.value, txt!.value);
    // The trail: made, standing changes, the change of name.
    const trail = await harness.asAdmin(() => harness.db.select().from(auditLogs)) as any[];
    assert.ok(trail.filter((a) => a.resourceType === 'custom_domain' && a.tenantId === tenantId).length >= 4);

    await removeCustomDomain(ctx);
    assert.equal(await customDomain(ctx), null);
    assert.equal((await harness.asAdmin(() => harness.db.select().from(customDomains)) as any[]).length, 0);
  } finally { await harness.close(); }
});

test('Enterprise only; owners and admins only; a resolver that fails changes nothing', async () => {
  const harness = await createTestDb();
  try {
    const pro = await store(harness, 'pro-shop', 'pro');
    await assert.rejects(() => setCustomDomain(pro.ctx, 'ar.pro-shop.sa'), (e: any) => e.code === 'plan_required');
    const { ctx } = await store(harness, 'bigco');
    await setCustomDomain(ctx, 'ar.bigco.sa');
    await assert.rejects(() => checkCustomDomain(ctx, { fetch: resolver({}, 2) }), (e: any) => e.code?.startsWith('upstream_'));
    assert.equal((await customDomain(ctx))!.checkedAt, null, 'nothing recorded from a check that could not look');
    const viewer = { ...ctx, can: () => false, require: (p: string) => { if (p !== 'settings:read') throw Object.assign(new Error('forbidden'), { code: 'forbidden' }); } } as any;
    await assert.rejects(() => setCustomDomain(viewer, 'x.bigco.sa'), (e: any) => e.code === 'forbidden');
    await assert.rejects(() => checkCustomDomain(viewer, { fetch: resolver() }), (e: any) => e.code === 'forbidden');
  } finally { await harness.close(); }
});
