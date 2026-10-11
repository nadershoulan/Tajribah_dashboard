/**
 * T137 — sharing a try-on picture: the share sheet is opened inside the tap (a phone refuses one opened after waiting),
 * refused or unsupported it saves the file, cancelled it does nothing; the picture is made from a data URL at once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataUrlBlob, sharePicture } from '@site/lib/share-picture';

function withNavigator(nav: object, run: () => Promise<void>) {
  const before = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const saved: string[] = [];
  Object.defineProperty(globalThis, 'navigator', { value: nav, configurable: true });
  Object.defineProperty(globalThis, 'document', { value: { createElement: () => ({ set download(n: string) { saved.push(n); }, click() {} }) }, configurable: true });
  return { saved, done: run().finally(() => { if (before) Object.defineProperty(globalThis, 'navigator', before); delete (globalThis as { document?: unknown }).document; }) };
}

test('a data URL becomes the same bytes at once', async () => {
  const blob = dataUrlBlob('data:image/png;base64,' + Buffer.from([137, 80, 78, 71, 1, 2, 3]).toString('base64'));
  assert.equal(blob.type, 'image/png');
  assert.deepEqual([...new Uint8Array(await blob.arrayBuffer())], [137, 80, 78, 71, 1, 2, 3]);
  assert.equal(await dataUrlBlob('data:text/plain,hi%20there').text(), 'hi there');
});

test('the share sheet opens inside the tap — before anything is waited for', async () => {
  let opened = false;
  const file = new File([new Uint8Array([1])], 'try-on.jpg', { type: 'image/jpeg' });
  const { done } = withNavigator({ canShare: () => true, share: async () => { opened = true; } }, async () => {
    const result = sharePicture(file, 'A watch');
    assert.equal(opened, true, 'called at once, not after a promise');
    assert.equal(await result, 'shared');
  });
  await done;
});

test('refused or unsupported: the file is saved; cancelled by the shopper: nothing', async () => {
  const file = new File([new Uint8Array([1])], 'try-on.jpg', { type: 'image/jpeg' });
  const refused = withNavigator({ canShare: () => true, share: async () => { throw new DOMException('no gesture', 'NotAllowedError'); } }, async () => {
    assert.equal(await sharePicture(file), 'saved');
  });
  await refused.done;
  assert.deepEqual(refused.saved, ['try-on.jpg']);
  const cancelled = withNavigator({ canShare: () => true, share: async () => { throw new DOMException('closed', 'AbortError'); } }, async () => {
    assert.equal(await sharePicture(file), 'cancelled');
  });
  await cancelled.done;
  assert.deepEqual(cancelled.saved, []);
  const none = withNavigator({}, async () => { assert.equal(await sharePicture(file), 'saved'); });
  await none.done;
  assert.deepEqual(none.saved, ['try-on.jpg']);
});
