/**
 * T86 — while store linking is version 2 (T81, `STORE_LINKING` off), nothing a merchant reads promises
 * it: the plans mark it as coming, the help centre teaches the feed link or file, and the Salla and Zid
 * pages start from a feed and say when direct linking comes.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { STORE_LINKING } from '@/lib/features';
import { PLANS } from '@/lib/plans';
import { HELP_ARTICLES } from '@site/content/help';
import { PLATFORM_PAGES } from '@site/content/platforms';

const PLATFORM = /سلة|زد|Salla|Zid|Shopify|WooCommerce/;
const text = (b: { ar: string; en: string }) => `${b.ar} ${b.en}`;

test('store linking off: no plan, help article or platform page promises it as available today', () => {
  if (STORE_LINKING) return; // version 2 has arrived: these pages may say so again
  for (const plan of PLANS) for (const line of plan.highlights) {
    if (PLATFORM.test(text(line))) assert.equal(line.soon, true, `${plan.code}: “${line.en}” is marked as coming`);
  }
  assert.ok(!HELP_ARTICLES.some((a) => a.slug.startsWith('connect-') && a.slug !== 'connect'), 'no “connect your store” article');
  const feed = HELP_ARTICLES.find((a) => a.slug === 'import-products');
  assert.ok(feed && /Google Merchant/.test(JSON.stringify(feed)) && /version 2/.test(JSON.stringify(feed)), 'the feed article, saying when linking comes');
  for (const page of Object.values(PLATFORM_PAGES)) {
    const all = JSON.stringify(page);
    assert.match(all, /Google Merchant/, `${page.slug}: starts from a feed`);
    assert.match(all, /version 2/, `${page.slug}: says when direct linking comes`);
    assert.doesNotMatch(all, /approve the permissions|Install the Tajribah app|Enable the Tajribah app/, `${page.slug}: no app to install today`);
  }
  const integrations = readFileSync(join(process.cwd(), 'site', 'components', 'pages', 'Integrations.tsx'), 'utf8');
  assert.doesNotMatch(integrations, /approved in one step|Direct integrations with the platforms/, 'the integrations page starts from a feed');
});
