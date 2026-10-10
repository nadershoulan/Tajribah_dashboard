/**
 * T133 — uuid v7 ids are strictly increasing within a process, even many in one millisecond, so "newest first" by id is
 * exact; they stay valid v7 (version, variant, the time they were minted at); an old time keeps its own timestamp.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isUuid, uuidv7, uuidv7Time } from '@/lib/ids';

test('across milliseconds too, and thousands in a tight loop', () => {
  const ids = Array.from({ length: 20_000 }, () => uuidv7());
  assert.deepEqual([...ids].sort(), ids);
});

test('ids minted in the same millisecond count up: sorted is the order they were made', () => {
  const t = Date.now() + 10_000; // a fresh millisecond, all of them in it (after the test above: time only moves on)
  const ids = Array.from({ length: 1500 }, () => uuidv7(t));
  assert.deepEqual([...ids].sort(), ids, 'strictly increasing');
  assert.equal(new Set(ids).size, ids.length, 'no two alike');
  assert.ok(ids.every((id) => uuidv7Time(id) >= t && uuidv7Time(id) <= t + 1), 'the time is kept (a millisecond borrowed at most)');
});

test('still a valid v7: version, variant, time; an older time keeps its own timestamp', () => {
  const id = uuidv7();
  assert.ok(isUuid(id));
  assert.equal(id[14], '7', 'version 7');
  assert.match(id[19]!, /[89ab]/, 'variant 10xx');
  const past = Date.UTC(2026, 0, 1);
  assert.equal(uuidv7Time(uuidv7(past)), past, 'a time well before the last keeps itself');
});
