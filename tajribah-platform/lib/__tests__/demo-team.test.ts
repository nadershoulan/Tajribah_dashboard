import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoSource } from '@/lib/data';
import { ApiError } from '@/lib/api-client';

test('the preview team: invite, change a role, remove, and the same refusals as the API', async () => {
  await demoSource.invite('New@Example.test', 'analyst');
  const invited = (await demoSource.team()).find((m) => m.email === 'new@example.test')!;
  assert.deepEqual([invited.status, invited.role], ['invited', 'analyst']);
  await demoSource.revokeInvitation(invited.id);
  assert.ok(!(await demoSource.team()).some((m) => m.email === 'new@example.test'));

  const owner = (await demoSource.team()).find((m) => m.role === 'owner')!;
  const other = (await demoSource.team()).find((m) => m.role !== 'owner' && m.status === 'active')!;
  await demoSource.changeRole(other.id, 'viewer');
  assert.equal((await demoSource.team()).find((m) => m.id === other.id)!.role, 'viewer');
  await assert.rejects(() => demoSource.changeRole(owner.id, 'viewer'), (e: unknown) => e instanceof ApiError && e.status === 403);
  await assert.rejects(() => demoSource.removeMember(owner.id), (e: unknown) => e instanceof ApiError && e.status === 403);
  await assert.rejects(() => demoSource.invite('x', 'viewer'), (e: unknown) => e instanceof ApiError && e.status === 422);
  await assert.rejects(() => demoSource.invite('boss@example.test', 'owner'), (e: unknown) => e instanceof ApiError && e.status === 422);
  await demoSource.removeMember(other.id);
  assert.ok(!(await demoSource.team()).some((m) => m.id === other.id));
});
