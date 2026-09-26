/**
 * P1.2b — TOTP against RFC 6238 Appendix B (the codes every authenticator app computes),
 * the acceptance window, replay refusal, and backup code shape.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BACKUP_CODE_COUNT, base32Decode, base32Encode, matchTotp, newBackupCodes, newTotpSecret, normaliseBackupCode,
  otpauthUrl, stepAt, totpCode,
} from '@/server/core/auth/totp';

// RFC 6238 Appendix B, SHA-1: the ASCII key "12345678901234567890".
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

test('RFC 6238 test vectors (SHA-1), 8 digits and the 6-digit codes apps show', async () => {
  assert.equal(RFC_SECRET, 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  const vectors: [number, string][] = [
    [59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'],
    [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130'],
  ];
  for (const [seconds, expected] of vectors) {
    const step = stepAt(seconds * 1000);
    assert.equal(await totpCode(RFC_SECRET, step, 8), expected, `T=${seconds}`);
    assert.equal(await totpCode(RFC_SECRET, step), expected.slice(-6), `T=${seconds}, 6 digits`);
  }
});

test('base32 round-trips, and tolerates what people type from a printed key', () => {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  assert.deepEqual(base32Decode(base32Encode(bytes)), bytes);
  assert.deepEqual(base32Decode('gezd gnbv-gy3t'), base32Decode('GEZDGNBVGY3T'));
  assert.throws(() => base32Decode('GEZD1'), /base32/, '1 is not a base32 letter');
  const secret = newTotpSecret();
  assert.equal(base32Decode(secret).length, 20, '160-bit secrets');
  assert.notEqual(newTotpSecret(), secret);
});

test('one step either side is accepted; two is not; a used step is refused', async () => {
  const now = 1_790_000_000_000;
  const step = stepAt(now);
  const at = (offset: number) => totpCode(RFC_SECRET, step + offset);
  assert.equal(await matchTotp(RFC_SECRET, await at(0), { now }), step);
  assert.equal(await matchTotp(RFC_SECRET, await at(-1), { now }), step - 1, 'a phone clock a little behind');
  assert.equal(await matchTotp(RFC_SECRET, await at(1), { now }), step + 1, 'a phone clock a little ahead');
  assert.equal(await matchTotp(RFC_SECRET, await at(2), { now }), null);
  assert.equal(await matchTotp(RFC_SECRET, await at(-2), { now }), null);

  assert.equal(await matchTotp(RFC_SECRET, await at(0), { now, afterStep: step }), null, 'the same step twice');
  assert.equal(await matchTotp(RFC_SECRET, await at(-1), { now, afterStep: step }), null, 'an older step after a newer one');
  assert.equal(await matchTotp(RFC_SECRET, await at(1), { now, afterStep: step }), step + 1);
});

test('typed codes: spaces and Arabic-Indic digits accepted; anything else refused', async () => {
  const now = 1_790_000_000_000;
  const code = await totpCode(RFC_SECRET, stepAt(now));
  const arabic = code.replace(/\d/g, (d) => String.fromCharCode(0x0660 + Number(d)));
  assert.equal(await matchTotp(RFC_SECRET, `${code.slice(0, 3)} ${code.slice(3)}`, { now }), stepAt(now));
  assert.equal(await matchTotp(RFC_SECRET, arabic, { now }), stepAt(now), 'a Saudi keyboard types ٠–٩');
  for (const bad of ['', '12345', '1234567', 'abcdef', `${code}x`]) {
    assert.equal(await matchTotp(RFC_SECRET, bad, { now }), null, JSON.stringify(bad));
  }
});

test('backup codes: ten, distinct, unambiguous characters; normalised for comparison', () => {
  const codes = newBackupCodes();
  assert.equal(codes.length, BACKUP_CODE_COUNT);
  assert.equal(new Set(codes).size, codes.length);
  for (const code of codes) assert.match(code, /^[a-hjkmnp-z2-9]{4}-[a-hjkmnp-z2-9]{4}$/, 'no 0, o, 1, l or i');
  assert.equal(normaliseBackupCode(' ABCD-efgh '), 'abcdefgh');
  assert.equal(normaliseBackupCode('abcd efgh'), 'abcdefgh');
});

test('otpauth URI carries the issuer and account apps display', () => {
  const url = new URL(otpauthUrl({ secret: 'ABC', account: 'owner@example.test', issuer: 'Tajribah' }));
  assert.equal(url.protocol, 'otpauth:');
  assert.equal(url.host, 'totp');
  assert.equal(decodeURIComponent(url.pathname), '/Tajribah:owner@example.test');
  assert.equal(url.searchParams.get('secret'), 'ABC');
  assert.equal(url.searchParams.get('issuer'), 'Tajribah');
  assert.equal(url.searchParams.get('digits'), '6');
});
