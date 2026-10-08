/**
 * P7 (T122/T124) — work after the answer: handed to the platform when it can keep it alive, done inline
 * otherwise, and retried when it fails (the ingest load test lost 10% of batches to refused connections).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { afterAnswer, setBackgroundRunner } from '@/server/core/http/background';
import { setLogLevel } from '@/server/core/observability/log';

setLogLevel('error');

test('a failing piece of work is tried again, and the attempt number is passed on', async () => {
  const seen: number[] = [];
  await afterAnswer('t', async (attempt) => { seen.push(attempt); if (attempt < 3) throw new Error('too many connections'); }, { pauseMs: [0] });
  assert.deepEqual(seen, [1, 2, 3], 'two refusals, then it went through');
});

test('after the last attempt it gives up quietly — the answer has long gone, nothing is thrown', async () => {
  let tries = 0;
  await afterAnswer('t', async () => { tries++; throw new Error('down'); }, { attempts: 3, pauseMs: [0] });
  assert.equal(tries, 3);
});

test('with a runner installed the work is handed over, not awaited', async () => {
  const handed: Promise<unknown>[] = [];
  let done = false;
  setBackgroundRunner((work) => { handed.push(work); });
  try {
    await afterAnswer('t', async () => { await new Promise((r) => setTimeout(r, 10)); done = true; });
    assert.equal(done, false, 'returned before the work finished');
    await Promise.all(handed);
    assert.equal(done, true);
  } finally { setBackgroundRunner(null); }
});
