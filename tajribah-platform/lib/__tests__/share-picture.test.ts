/**
 * T137 — sharing a try-on picture: the share sheet is opened inside the tap (a phone refuses one opened after waiting),
 * refused or unsupported it saves the file, cancelled it does nothing; the picture is made from a data URL at once.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataUrlBlob, inviteText, linkOrHere, shareLinkOf, sharePicture } from '@site/lib/share-picture';

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

test('the share sheet opens inside the tap — the picture with the product’s name and the link to try it', async () => {
  let opened: { files?: File[]; title?: string; text?: string; url?: string } | null = null;
  const file = new File([new Uint8Array([1])], 'try-on.jpg', { type: 'image/jpeg' });
  const link = 'https://failet.sa/ar/watch/p1617831548';
  const { done } = withNavigator({ canShare: () => true, share: async (d: typeof opened) => { opened = d; } }, async () => {
    const result = sharePicture(file, { title: 'ساعة', text: inviteText('ساعة', link, true), url: link });
    assert.ok(opened, 'called at once, not after a promise');
    assert.equal(await result, 'shared');
  });
  await done;
  assert.equal(opened!.files![0], file);
  assert.equal(opened!.url, undefined, 'the link once — in the text (a phone adds `url` after the text, it would show twice)');
  assert.equal(opened!.text, `ساعة — جرّبها عليك من هنا: ${link}`, 'and in the text too (some apps keep only the text)');
  assert.equal(inviteText('Watch', null, false), 'Watch', 'no link: just the name');
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

test('a link not in the text goes as the address', async () => {
  let opened: { url?: string } | null = null;
  const file = new File([new Uint8Array([1])], 'try-on.jpg', { type: 'image/jpeg' });
  const { done } = withNavigator({ canShare: () => true, share: async (d: typeof opened) => { opened = d; } }, async () => {
    await sharePicture(file, { title: 'Watch', url: 'https://tajribah.org/p/ward/1' });
  });
  await done;
  assert.equal(opened!.url, 'https://tajribah.org/p/ward/1');
});

test('the link shared: the store page the window is over, if the browser agrees; else the product’s try-on page; none in the preview', () => {
  const q = (s: string) => new URLSearchParams(s);
  const page = 'https://failet.sa/ar/watch/p1617831548';
  const from = `store=failet&product=244167095&from=${encodeURIComponent(page)}`;
  assert.equal(shareLinkOf(q(from), 'https://failet.sa/', 'https://tajribah.org'), page);
  assert.equal(shareLinkOf(q(from), 'https://evil.example/', 'https://tajribah.org'), 'https://tajribah.org/p/failet/244167095', 'another site claiming it: ours');
  assert.equal(shareLinkOf(q(from), '', 'https://tajribah.org'), 'https://tajribah.org/p/failet/244167095', 'no referrer: ours');
  assert.equal(shareLinkOf(q(`store=failet&product=1&from=${encodeURIComponent('http://failet.sa/p')}`), 'http://failet.sa/', 'https://tajribah.org'), 'https://tajribah.org/p/failet/1', 'not https: ours');
  assert.equal(shareLinkOf(q('store=a b&product=x/y'), '', 'https://tajribah.org'), 'https://tajribah.org/p/a%20b/x%2Fy');
  assert.equal(shareLinkOf(q(`${from}&preview=1`), 'https://failet.sa/', 'https://tajribah.org'), null, 'the preview');
  assert.equal(shareLinkOf(q('store=failet'), '', 'https://tajribah.org'), null, 'no product');
});

test('a link given is shared; none given (null, the preview) none; not given at all: this page, without its # part', () => {
  assert.equal(linkOrHere('https://failet.sa/p/1'), 'https://failet.sa/p/1');
  assert.equal(linkOrHere(null), null);
  Object.defineProperty(globalThis, 'location', { value: { href: 'https://tajribah.org/p/ward/1#top' }, configurable: true });
  try {
    assert.equal(linkOrHere(undefined), 'https://tajribah.org/p/ward/1');
    assert.equal(linkOrHere(null), null, 'none given stays none, even on a page');
  } finally { delete (globalThis as { location?: unknown }).location; }
  assert.equal(linkOrHere(undefined), null, 'no page (the server)');
});

