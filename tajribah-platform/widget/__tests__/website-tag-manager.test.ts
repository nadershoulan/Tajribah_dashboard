/**
 * T95 — the help centre's Tag Manager article names the dashboard's own words, so a merchant following it finds
 * each one: the install page's tab, the sync button, the checker; and it promises no trigger the tag does not need.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { HELP_ARTICLES } from '@site/content/help';

const source = (file: string) => readFileSync(join(process.cwd(), 'components', 'pages', file), 'utf8');

test('the Salla + Google Tag Manager article: in “Connecting your store”, in the dashboard’s own words', () => {
  const article = HELP_ARTICLES.find((a) => a.slug === 'salla-google-tag-manager');
  assert.ok(article, 'the article exists');
  assert.equal(article.category, 'connect');
  const steps = (article.steps ?? []).map((s) => s.ar).join(' ');
  const embed = source('Embed.tsx');
  for (const words of ['التركيب في متجرك', 'سلة: عبر Google Tag Manager', 'تحقّق من التركيب']) {
    assert.ok(steps.includes(words), `the article says «${words}»`);
    assert.ok(embed.includes(`'${words}'`), `and the install page shows «${words}»`);
  }
  for (const gtm of ['Custom HTML', 'All Pages', 'Submit', 'Publish']) assert.ok(steps.includes(gtm), `Tag Manager’s own “${gtm}”`);
  const body = article.body.map((b) => b.ar).join(' ');
  assert.ok(body.includes('/p'), 'how the tag knows a product page');
  assert.ok(source('Connections.tsx').includes(`t('مزامنة الآن', 'Sync now')`), 'the sync button the install page names');
  assert.ok(embed.includes('«مزامنة الآن»') && !embed.includes('«زامن الآن»'), 'the install page names that button as it is labelled');
});
