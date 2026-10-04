/**
 * Product-page visits (../tajribah-try-on/lib/page-events.ts) — the sending half: the batch the page
 * sends is one the collector accepts (its own parser), marked as the product page and how it was
 * reached; nothing is sent when the browser signals no tracking; the page counts a visit once, and an
 * AR placement; the page policy lets it reach the collector.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseBatch } from '@/lib/contracts/analytics';
import { EVENTS_ENDPOINT, noTracking, pageBatch, viaOf } from '@site/lib/page-events';
import { pageCsp } from '@site/lib/security';
import { sitePath } from './site-path';

const site = (p: string) => readFileSync(sitePath(p), 'utf8');

test('the page’s batch is one the collector accepts: the product, the page, how it was reached', () => {
  const batch = pageBatch('oud', 'sa-123', 'product_view', 'qr', 'AbCdEfGhIjKlMnOpQrSt', 1_790_000_000_000);
  const parsed = parseBatch(batch);
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.reason);
  assert.deepEqual(parsed.ok && parsed.batch.events[0], { type: 'product_view', t: 0, productId: 'sa-123', properties: { surface: 'page', via: 'qr' } });
  assert.ok(parseBatch(pageBatch('oud', 'sa-123', 'ar_open', 'link', 'AbCdEfGhIjKlMnOpQrSt', 1)).ok);
  assert.equal(EVENTS_ENDPOINT, 'https://ev.tajribah.com/v1/e', 'the widget’s collector');
  assert.match(site('../tajribah-platform/widget/src/main.ts'), /DEFAULT_EVENTS = 'https:\/\/ev\.tajribah\.com\/v1\/e'/, 'the same address as the widget');
});

test('how it was reached, and no tracking when the browser says so', () => {
  assert.equal(viaOf('?s=qr'), 'qr');
  assert.equal(viaOf('?lang=en'), 'link');
  assert.equal(viaOf(''), 'link');
  assert.equal(noTracking({ doNotTrack: '1' }), true);
  assert.equal(noTracking({ globalPrivacyControl: true }), true);
  assert.equal(noTracking({}, { doNotTrack: 'yes' }), true);
  assert.equal(noTracking({ doNotTrack: '0' }), false);
});

test('the page counts a visit once, and an AR placement; the policy lets it reach the collector', () => {
  const page = site('components/pages/HostedPage.tsx');
  assert.match(page, /if \(state\.kind !== 'ready' \|\| counted\.current\) return;/, 'once, and only for a product that is there');
  assert.match(page, /trackPage\(store, product, 'product_view'/);
  assert.match(page, /trackPage\(store, product, 'ar_open'/);
  assert.ok(pageCsp('x').includes('https://ev.tajribah.com'));
});
