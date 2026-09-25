import { test } from 'node:test';
import assert from 'node:assert/strict';
import { demoSource } from '@/lib/data';
import { ApiError } from '@/lib/api-client';

test('the preview library: versions with a live one, rollback by publishing, refusals like the API', async () => {
  const [first] = await demoSource.models();
  const versions = await demoSource.modelVersions(first.id);
  assert.equal(versions.filter((v) => v.isCurrent).length, 1);
  const older = versions.find((v) => !v.isCurrent && v.status === 'ready')!;
  await demoSource.publishVersion(older.id);
  assert.equal((await demoSource.modelVersions(first.id)).find((v) => v.isCurrent)?.id, older.id, 'rolled back');

  const processing = (await demoSource.models()).find((m) => m.status === 'processing')!;
  await assert.rejects(() => demoSource.publishVersion(`${processing.id}@${processing.version}`), (e: unknown) => e instanceof ApiError && e.status === 409);
  await assert.rejects(() => demoSource.modelVersions('nope'), (e: unknown) => e instanceof ApiError && e.status === 404);

  await assert.rejects(() => demoSource.uploadModel(new File(['x'], 'photo.png')), (e: unknown) => e instanceof ApiError && e.status === 422);
  const uploaded = await demoSource.uploadModel(new File(['x'], 'lamp.glb'));
  assert.equal(uploaded.status, 'processing');
  assert.equal((await demoSource.models())[0].name, 'lamp');
});
