/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T115 — the contact form kept in the database: a bot that fills the trap is told "sent" and nothing is kept;
 * fields are checked; Turnstile must pass on the server (and in production there is no way round it); 5 an hour
 * per sender; the sender's address is never stored, only a keyed hash. Staff: the inbox newest first with a
 * count per status, opening reads, moving and deleting go into the staff trail (a deletion needs a reason), and
 * the application role cannot read a single message.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import { appDb, unsafeAdminDb } from '@/db/client';
import { contactMessages, staffAudit } from '@/db/schema';
import { setLogLevel } from '@/server/core/observability/log';
import { MemoryRateLimiter, setRateLimiter } from '@/server/core/ratelimit/limiter';
import { createTestDb, seedTenant } from '@/server/testing/harness';
import type { StaffContext } from '@/server/modules/admin/access';
import { contactInbox, deleteContact, setContactStatus } from '@/server/modules/admin/contact';
import { submitContact, type ContactDeps } from '../service';
import { TURNSTILE_ACTION, turnstileVerifier } from '@/server/core/http/turnstile';

setLogLevel('error');
const PASS: ContactDeps = { verify: async () => ({ ok: true }), requireTurnstile: true, hashKey: 'k'.repeat(48) };
const META = { ip: '203.0.113.7', userAgent: 'Mozilla/5.0 test' };
const GOOD = { name: 'نادر', email: 'Owner@Shop.SA ', phone: '0501234567', store: 'https://shop.sa', platform: 'salla', message: 'نبيع ساعات، ونريد تجربة على المعصم.', lang: 'ar', token: 'tok' };
const STAFF = (id: string): StaffContext => ({ userId: id, email: 'staff@tajribah.test', fullName: 'Staff', requestId: 'r' });

test('a real message is kept — tidied, with a keyed hash of the address, never the address', async () => {
  const harness = await createTestDb();
  try {
    setRateLimiter(new MemoryRateLimiter());
    const kept = await submitContact(GOOD, META, PASS);
    assert.equal(kept.stored, true);
    const [row] = await unsafeAdminDb().select().from(contactMessages);
    assert.equal(row!.email, 'owner@shop.sa', 'trimmed and lower-cased');
    assert.equal(row!.name, 'نادر');
    assert.equal(row!.status, 'new');
    assert.equal(row!.platform, 'salla');
    assert.match(row!.ipHash!, /^[0-9a-f]{32}$/);
    assert.ok(!JSON.stringify(row).includes('203.0.113.7'), 'the address itself is nowhere');
    const again = await submitContact({ ...GOOD, email: 'b@shop.sa' }, META, PASS);
    const rows = await unsafeAdminDb().select().from(contactMessages);
    assert.equal(rows.find((r) => r.id === again.id)!.ipHash, row!.ipHash, 'the same sender can be recognised');
  } finally { await harness.close(); }
});

test('the trap: a filled hidden field is answered like a send, and nothing is kept', async () => {
  const harness = await createTestDb();
  try {
    setRateLimiter(new MemoryRateLimiter());
    let asked = false;
    const result = await submitContact({ ...GOOD, website: 'http://spam.example' }, META, { ...PASS, verify: async () => { asked = true; return { ok: true }; } });
    assert.deepEqual(result, { stored: false });
    assert.equal(asked, false, 'Turnstile is not even asked');
    assert.equal((await unsafeAdminDb().select().from(contactMessages)).length, 0);
  } finally { await harness.close(); }
});

test('field checks, Turnstile on the server, and no way round it in production', async () => {
  const harness = await createTestDb();
  try {
    setRateLimiter(new MemoryRateLimiter());
    // Each from its own address: the rate limit counts refused attempts too (it runs first, so junk cannot dodge it).
    let n = 0;
    const from = () => ({ ...META, ip: `192.0.2.${++n}` });
    const bad = (input: object) => assert.rejects(() => submitContact({ ...GOOD, ...input }, from(), PASS), (e: any) => e.code === 'validation_failed');
    await bad({ name: 'x' });
    await bad({ email: 'not-an-email' });
    await bad({ store: 'javascript:alert(1)' });
    await bad({ phone: '05<script>' });
    await bad({ platform: 'myspace' });
    await bad({ message: 'x'.repeat(4001) });
    await assert.rejects(() => submitContact(GOOD, from(), { ...PASS, verify: async () => ({ ok: false, reason: 'turnstile: invalid-input-response' }) }),
      (e: any) => e.code === 'validation_failed' && 'token' in e.errors, 'a failed check is refused');
    await assert.rejects(() => submitContact(GOOD, from(), { ...PASS, verify: null }), (e: any) => e.code === 'not_implemented', 'production without a secret refuses');
    assert.equal((await submitContact(GOOD, from(), { ...PASS, verify: null, requireTurnstile: false })).stored, true, 'on this computer, without keys, it works');
  } finally { await harness.close(); }
});

test('5 an hour per sender; a sixth is refused, another sender is not', async () => {
  const harness = await createTestDb();
  try {
    setRateLimiter(new MemoryRateLimiter());
    for (let i = 0; i < 5; i++) await submitContact({ ...GOOD, email: `s${i}@shop.sa` }, META, PASS);
    await assert.rejects(() => submitContact(GOOD, META, PASS), (e: any) => e.code === 'rate_limited');
    assert.equal((await submitContact(GOOD, { ...META, ip: '198.51.100.1' }, PASS)).stored, true);
  } finally { await harness.close(); }
});

test('Turnstile: success for our hostname and our action only; Cloudflare unreachable is a no', async () => {
  const answer = (body: object) => (async () => new Response(JSON.stringify(body))) as unknown as typeof fetch;
  const sent: FormData[] = [];
  const capture = (async (_url: string, init: { body: FormData }) => { sent.push(init.body); return new Response(JSON.stringify({ success: true, hostname: 'tajribah.org', action: TURNSTILE_ACTION })); }) as unknown as typeof fetch;
  assert.deepEqual(await turnstileVerifier('sec', ['tajribah.org'], capture)('tok', '203.0.113.7'), { ok: true });
  assert.equal(sent[0]!.get('secret'), 'sec');
  assert.equal(sent[0]!.get('remoteip'), '203.0.113.7');
  assert.equal((await turnstileVerifier('sec', ['tajribah.org'], answer({ success: false, 'error-codes': ['timeout-or-duplicate'] }))('tok', null)).ok, false, 'a reused token');
  assert.equal((await turnstileVerifier('sec', ['tajribah.org'], answer({ success: true, hostname: 'evil.example', action: TURNSTILE_ACTION }))('tok', null)).ok, false, 'another site’s token');
  assert.equal((await turnstileVerifier('sec', ['tajribah.org'], answer({ success: true, hostname: 'tajribah.org', action: 'login' }))('tok', null)).ok, false, 'another form’s token');
  assert.equal((await turnstileVerifier('sec', [], (async () => { throw new Error('down'); }) as unknown as typeof fetch)('tok', null)).ok, false);
  assert.equal((await turnstileVerifier('sec', [], capture)('', null)).ok, false, 'no token, no call');
});

test('staff: newest first with counts; opening reads; moves and deletions are in the trail; the app role sees nothing', async () => {
  const harness = await createTestDb();
  try {
    setRateLimiter(new MemoryRateLimiter());
    const store = await seedTenant(harness, 'alpha');
    const staff = STAFF(store.userId);
    const a = await submitContact({ ...GOOD, name: 'Aaa' }, META, PASS);
    await new Promise((r) => setTimeout(r, 5));
    const b = await submitContact({ ...GOOD, name: 'Bbb' }, { ...META, ip: '198.51.100.2' }, PASS);
    let inbox = await contactInbox({ status: 'new' });
    assert.deepEqual(inbox.items.map((m) => m.name), ['Bbb', 'Aaa'], 'newest first');
    assert.deepEqual(inbox.counts, { new: 2, read: 0, archived: 0 });

    const read = await setContactStatus(staff, a.id!, 'read');
    assert.equal(read.status, 'read');
    assert.ok(read.handledAt);
    await setContactStatus(staff, a.id!, 'archived');
    inbox = await contactInbox({ status: 'all' });
    assert.deepEqual(inbox.counts, { new: 1, read: 0, archived: 1 });
    assert.equal((await setContactStatus(staff, a.id!, 'new')).handledAt, null, 'back to new: unhandled again');

    await assert.rejects(() => deleteContact(staff, b.id!, 'no'), (e: any) => e.code === 'validation_failed', 'a reason');
    await deleteContact(staff, b.id!, 'spam from a bot');
    await assert.rejects(() => deleteContact(staff, b.id!, 'spam from a bot'), (e: any) => e.code === 'not_found');
    const trail = await unsafeAdminDb().select().from(staffAudit);
    assert.deepEqual(trail.map((r) => r.action).sort(), ['contact.delete', 'contact.status', 'contact.status', 'contact.status']);
    assert.ok(!JSON.stringify(trail).includes('نبيع ساعات'), 'the trail keeps no message text');

    const denied = (e: any) => { for (let x = e; x; x = x.cause) if (/permission denied/.test(String(x.message))) return true; return false; };
    await assert.rejects(() => appDb().execute(sql`select count(*) from contact_messages`), denied, 'the application role cannot read');
    await assert.rejects(() => appDb().execute(sql`delete from contact_messages`), denied, 'nor delete');
  } finally { await harness.close(); }
});

test('a phone typed in Arabic-Indic digits is kept in ASCII', async () => {
  const harness = await createTestDb();
  try {
    setRateLimiter(new MemoryRateLimiter());
    const arabic = String.fromCharCode(0x0660 + 0, 0x0660 + 5, 0x0660 + 0, 0x0660 + 1, 0x0660 + 2);
    const kept = await submitContact({ ...GOOD, phone: arabic }, META, PASS);
    const rows = await unsafeAdminDb().select().from(contactMessages);
    assert.equal(rows.find((r) => r.id === kept.id)!.phone, '05012');
  } finally { await harness.close(); }
});
