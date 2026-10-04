/** T75: on this computer, published configs live in the local storage — they survive a restart. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configStore, configureConfigStore, isLocalStorage, LocalStorageConfigStore, MemoryConfigStore } from '@/server/core/edge/configs';
import { MemoryStorage } from '@/server/core/storage/storage';

test('a config written to the local storage reads back from a new store (a restart), and is gone when withdrawn', async () => {
  const objects = new MemoryStorage();
  await new LocalStorageConfigStore(objects).put('shop/watch', '{"v":1}');
  const afterRestart = new LocalStorageConfigStore(objects);
  assert.equal(await afterRestart.get('shop/watch'), '{"v":1}');
  assert.equal(await afterRestart.get('shop/other'), null);
  await afterRestart.delete('shop/watch');
  assert.equal(await afterRestart.get('shop/watch'), null);
});

test('only storage on this computer is used so; anywhere else nothing changes', () => {
  assert.equal(isLocalStorage({ STORAGE_PROVIDER: 's3', S3_ENDPOINT: 'http://127.0.0.1:8333' }), true);
  assert.equal(isLocalStorage({ STORAGE_PROVIDER: 's3', S3_ENDPOINT: 'http://localhost:9000/' }), true);
  assert.equal(isLocalStorage({ STORAGE_PROVIDER: 's3', S3_ENDPOINT: 'https://acc.r2.cloudflarestorage.com' }), false, 'R2 through S3');
  assert.equal(isLocalStorage({ STORAGE_PROVIDER: 's3', S3_ENDPOINT: 'http://127.0.0.1.evil.com' }), false);
  assert.equal(isLocalStorage({ STORAGE_PROVIDER: 'r2' }), false);
  assert.equal(isLocalStorage({ STORAGE_PROVIDER: 'memory' }), false);

  const objects = new MemoryStorage();
  try {
    configureConfigStore({ STORAGE_PROVIDER: 's3', S3_ENDPOINT: 'http://127.0.0.1:8333' }, undefined, objects);
    assert.ok(configStore() instanceof LocalStorageConfigStore, 'this computer: the local storage');
    configureConfigStore({ STORAGE_PROVIDER: 'memory' }, undefined, objects);
    assert.ok(configStore() instanceof MemoryConfigStore, 'otherwise memory, as before (tests, previews)');
    assert.throws(() => configureConfigStore({ CONFIG_STORE: 'kv', STORAGE_PROVIDER: 's3', S3_ENDPOINT: 'http://127.0.0.1:8333' }, undefined, objects), /KV/, 'kv asked for: kv, never the local storage');
  } finally {
    configureConfigStore({});
  }
});
