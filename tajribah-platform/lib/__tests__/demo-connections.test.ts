import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoSource } from '@/lib/data';
import { ApiError } from '@/lib/api-client';

test('the preview store: sync now finishes at once, disconnect sticks, a disconnected store refuses to sync', async () => {
  const [before] = await demoSource.connections();
  assert.equal(before.status, 'active');
  assert.ok(!('accessToken' in before));
  const done = await demoSource.syncNow(before.id);
  assert.deepEqual([done.status, done.triggeredBy], ['done', 'user']);
  assert.equal((await demoSource.connections())[0].latestSync?.id, done.id);
  await demoSource.disconnect(before.id);
  assert.equal((await demoSource.connections())[0].status, 'revoked');
  await assert.rejects(() => demoSource.syncNow(before.id), (e: unknown) => e instanceof ApiError && e.status === 409);
  await assert.rejects(() => demoSource.disconnect('nope'), (e: unknown) => e instanceof ApiError && e.status === 404);
});
