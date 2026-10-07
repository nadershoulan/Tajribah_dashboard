/**
 * T108 — the database's own backups: sealed to a public key the server holds (it can encrypt, never read),
 * opened only with the private key, any changed byte refused; pruned to 14 nights and then 8 weekly copies,
 * a backup's dump and manifest together.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { backupKeyPair, open, seal, toPrune } from '../../scripts/dr/seal.mjs';

test('sealed with the public key, opened only with its private key', () => {
  const { publicPem, privatePem } = backupKeyPair();
  const data = Buffer.from('PGDMP… متجر عود — 1234 rows');
  const sealed = seal(data, publicPem);
  assert.ok(!sealed.includes(data), 'the dump is not readable in the file');
  assert.ok(!sealed.includes(Buffer.from('متجر')), 'nor any part of it');
  assert.deepEqual(open(sealed, privatePem), data);
  assert.notDeepEqual(seal(data, publicPem), sealed, 'a fresh key and IV every time');
  assert.throws(() => open(sealed, backupKeyPair().privatePem), 'another private key cannot open it');
  for (const at of [20, sealed.length - 30, sealed.length - 1]) {
    const changed = Buffer.from(sealed);
    changed[at]! ^= 1;
    assert.throws(() => open(changed, privatePem), `a changed byte at ${at} is refused`);
  }
  assert.throws(() => open(Buffer.from('not a backup at all, just bytes'), privatePem), /not a Tajribah backup/);
});

test('the committed key is a public X25519 key, never a private one', () => {
  const pem = readFileSync(join(process.cwd(), 'deploy/server/backup-public.pem'), 'utf8');
  assert.match(pem, /^-----BEGIN PUBLIC KEY-----/);
  assert.doesNotMatch(pem, /PRIVATE/);
  assert.ok(seal(Buffer.from('x'), pem).length > 0, 'it encrypts');
});

/** Sealed once on 2026-10-07 with a throwaway test key (not the real one): every later version must still open it. */
const FORMAT_1 = {
  privatePem: "-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VuBCIEIDjSqsjfX3x8GIxPWQYbJ63j+uMEoEG/E2ythu8j6nBR\n-----END PRIVATE KEY-----\n",
  sealed: 'VEpSQi1CQUNLVVAtMQpXvvGdXxRYD8CWYlXVfLyuUrRDI0DZom29oyjM+xHcETOafqQjR+AHB5ZMZWxZE2y8QnGISDBbCNsfvz/5VAck8u3fQ1NcOGlJuTYeKJsbd9HfhXQ=',
};

test('a backup sealed by the first version still opens — a change to the format would strand every stored backup', () => {
  assert.equal(open(Buffer.from(FORMAT_1.sealed, 'base64'), FORMAT_1.privatePem).toString(), 'tajribah backup format 1');
});

const key = (stamp: string, part: 'dump' | 'manifest.json' = 'dump') => `db/tajribah-${stamp}.${part}.sealed`;
const night = (day: string) => `${day}T00-15-07-123Z`;

test('pruning: every night for 14 days, then the newest of each week for 8 weeks; dump and manifest together', () => {
  const now = new Date('2026-12-31T01:00:00Z'); // a Thursday
  const days: string[] = [];
  for (let d = 0; d < 80; d++) days.push(new Date(Date.UTC(2026, 11, 31 - d)).toISOString().slice(0, 10));
  const keys = days.flatMap((day) => [key(night(day)), key(night(day), 'manifest.json')]);
  const pruned = new Set(toPrune(keys, now));
  const kept = days.filter((day) => !pruned.has(key(night(day))));

  for (const day of days.slice(0, 14)) assert.ok(kept.includes(day), `${day}: within 14 days`);
  assert.ok(!kept.includes(days[14]!) || new Date(`${days[14]}T00:00:00Z`).getUTCDay() === 0, 'day 15 goes unless it is its week’s newest');
  const older = kept.filter((day) => !days.slice(0, 14).includes(day));
  assert.ok(older.every((day) => new Date(`${day}T00:00:00Z`).getUTCDay() === 0), 'past 14 days, only each week’s newest (its Sunday) stays');
  assert.ok(older.length >= 5 && older.length <= 7, `about 6 weekly copies between day 14 and week 8 (${older.length})`);
  assert.ok(!kept.includes(days[79]!), 'past 8 weeks, gone');
  for (const day of days) assert.equal(pruned.has(key(night(day))), pruned.has(key(night(day), 'manifest.json')), `${day}: dump and manifest share a fate`);
});

test('pruning: two backups on one day — the week keeps the later, the night window keeps both; unknown keys are left alone', () => {
  const now = new Date('2026-12-31T01:00:00Z');
  const early = '2026-11-29T00-15-07-123Z', late = '2026-11-29T13-00-00-000Z'; // a Sunday, 32 days back
  const pruned = toPrune([key(early), key(late), 'db/README.txt', key(night('2026-12-30'))], now);
  assert.deepEqual(pruned, [key(early)]);
});
