import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  decryptSecret, encryptSecret, encryptionKeyId, hashPassword, hmac, keyedHash, needsRehash,
  otpCode, signJwt, timingSafeEqual, verifyJwt, verifyPassword,
} from '@/server/core/auth/crypto';

const SECRET = 'test-secret-at-least-32-characters-long!!';

test('password verifies, and a wrong password does not', async () => {
  const stored = await hashPassword('correct horse battery staple');
  assert.match(stored, /^pbkdf2\$sha256\$\d+\$/);
  assert.equal(await verifyPassword('correct horse battery staple', stored), true);
  assert.equal(await verifyPassword('Correct horse battery staple', stored), false);
  assert.equal(await verifyPassword('', stored), false);
});

test('the same password hashes differently every time', async () => {
  const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
  assert.notEqual(a, b, 'salts must differ');
  assert.equal(await verifyPassword('same', a), true);
  assert.equal(await verifyPassword('same', b), true);
});

test('a malformed or truncated hash is rejected, not thrown on', async () => {
  for (const bad of ['', 'x', 'pbkdf2$sha256$600000$onlyfour', 'argon2id$v=19$m=1$x$y', 'pbkdf2$sha256$0$c2FsdA==$aGFzaA==']) {
    assert.equal(await verifyPassword('anything', bad), false, `accepted: ${bad}`);
  }
});

test('needsRehash spots a weaker stored hash', async () => {
  assert.equal(needsRehash(await hashPassword('x')), false);
  assert.equal(needsRehash('pbkdf2$sha256$1000$c2FsdA==$aGFzaA=='), true);
  assert.equal(needsRehash('scrypt$whatever'), true, 'an unknown algorithm must be upgraded');
});

test('JWT round-trips, and tampering is caught', async () => {
  const token = await signJwt({ sub: 'user-1', sid: 'session-1', tid: 'tenant-1' }, SECRET, 900);
  const good = await verifyJwt(token, SECRET);
  assert.equal(good.ok, true);
  assert.equal(good.ok && good.claims.sub, 'user-1');
  assert.equal(good.ok && good.claims.tid, 'tenant-1');

  const wrongKey = await verifyJwt(token, SECRET + 'x');
  assert.deepEqual(wrongKey, { ok: false, reason: 'bad_signature' });

  const [h, b, s] = token.split('.');
  const swapped = await signJwt({ sub: 'attacker', sid: 'session-1' }, 'not-the-secret', 900);
  const forged = `${h}.${swapped.split('.')[1]}.${s}`;
  assert.equal((await verifyJwt(forged, SECRET)).ok, false, 'a swapped payload must fail');
  assert.equal((await verifyJwt(`${h}.${b}`, SECRET)).ok, false, 'a two-part token is malformed');
});

test('an expired token is rejected even with a valid signature', async () => {
  const token = await signJwt({ sub: 'u', sid: 's' }, SECRET, 1);
  const later = Date.now() + 2000;
  assert.deepEqual(await verifyJwt(token, SECRET, later), { ok: false, reason: 'expired' });
});

test('alg:none is not accepted', async () => {
  const header = btoa(JSON.stringify({ alg: 'none', typ: 'JWT' })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const body = btoa(JSON.stringify({ sub: 'x', sid: 'y', exp: Math.floor(Date.now() / 1000) + 60 }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  assert.equal((await verifyJwt(`${header}.${body}.`, SECRET)).ok, false);
});

test('keyedHash is domain-separated', async () => {
  const otp = await keyedHash(SECRET, 'phone_otp', '123456');
  const reset = await keyedHash(SECRET, 'password_reset', '123456');
  assert.notEqual(otp, reset, 'the same value under two purposes must not collide');
  assert.equal(otp, await keyedHash(SECRET, 'phone_otp', '123456'), 'and must be stable');
  assert.notEqual(await hmac(SECRET, 'x'), await hmac(SECRET + 'y', 'x'));
});

test('secrets round-trip, and a wrong key returns null rather than throwing', async () => {
  const envelope = await encryptSecret('salla-access-token-abc', SECRET);
  assert.match(envelope, /^v2\.[\w-]{8}\./, 'versioned, with the id of the key that sealed it');
  assert.ok(!envelope.includes('salla-access-token-abc'), 'the plaintext must not survive');
  assert.equal(await decryptSecret(envelope, SECRET), 'salla-access-token-abc');
  assert.equal(await decryptSecret(envelope, SECRET + 'x'), null);
  assert.equal(await decryptSecret('v1.broken', SECRET), null);
});

test('an envelope bound to one id does not open for another, or unbound', async () => {
  const envelope = await encryptSecret('token', SECRET, 'conn-a');
  assert.equal(await decryptSecret(envelope, SECRET, 'conn-a'), 'token');
  assert.equal(await decryptSecret(envelope, SECRET, 'conn-b'), null);
  assert.equal(await decryptSecret(envelope, SECRET), null);
});

test('key rotation: an envelope says which key sealed it, and the old key still opens it', async () => {
  const OLD = SECRET;
  const NEW = 'n'.repeat(40);
  const sealed = await encryptSecret('token', OLD, 'conn-a');
  assert.equal(sealed.split('.')[1], await encryptionKeyId(OLD));
  assert.notEqual(await encryptionKeyId(OLD), await encryptionKeyId(NEW));
  assert.equal(await decryptSecret(sealed, [NEW, OLD], 'conn-a'), 'token', 'the previous key opens what it sealed');
  assert.equal(await decryptSecret(sealed, [NEW], 'conn-a'), null, 'once the previous key is gone, it does not');
  // The key id must not be part of the AES key: that key is SHA-256(secret).
  const material = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(OLD)));
  const prefix = [Buffer.from(material).toString('hex'), Buffer.from(material).toString('base64url')].map((s) => s.slice(0, 8));
  assert.ok(!prefix.includes(await encryptionKeyId(OLD)), 'the key id leaks key bits');
  // Envelopes sealed before key ids existed (`v1.iv.data`) still open, under any given key.
  const [, , iv, data] = sealed.split('.');
  assert.equal(await decryptSecret(`v1.${iv}.${data}`, [NEW, OLD], 'conn-a'), 'token');
});

test('the same plaintext encrypts to different envelopes', async () => {
  const [a, b] = await Promise.all([encryptSecret('t', SECRET), encryptSecret('t', SECRET)]);
  assert.notEqual(a, b, 'the IV must be random per message');
});

test('otpCode is six digits and varies', () => {
  const codes = new Set(Array.from({ length: 50 }, () => otpCode()));
  for (const code of codes) assert.match(code, /^\d{6}$/);
  assert.ok(codes.size > 40, 'codes should not repeat this often');
});

test('timingSafeEqual compares contents, not references', () => {
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])), true);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])), false);
  assert.equal(timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3])), false);
});
