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

test('T96: wherever a Salla owner reads how to install, the Tag Manager way is there, and the install page is named as it is', async () => {
  const { PLATFORM_PAGES } = await import('@site/content/platforms');
  const { STEP_COPY: ONBOARDING_STEPS } = await import('@/lib/onboarding-steps');
  const salla = PLATFORM_PAGES.salla;
  const saysTags = (s: string) => s.includes('Google Tag Manager');
  assert.ok(salla.steps.some((s) => saysTags(s.body.ar) && saysTags(s.body.en)), 'the Salla page’s steps');
  assert.ok(salla.faq.some((f) => f.q.ar === 'هل أحتاج مطوّرًا؟' && saysTags(f.a.ar) && !f.a.ar.includes('قالبًا يقبل')), 'its “do I need a developer?” no longer asks for a theme that takes code');
  const embedStep = ONBOARDING_STEPS.find((s) => s.key === 'embed')!;
  assert.ok(saysTags(embedStep.description.ar) && saysTags(embedStep.description.en), 'the setup guide’s install step');
  assert.ok(saysTags(source('Onboarding.tsx')), 'and its panel');
  const integrations = readFileSync(join(process.cwd(), 'site', 'components', 'pages', 'Integrations.tsx'), 'utf8');
  assert.ok(saysTags(integrations) && integrations.includes('«التركيب في متجرك»') && !integrations.includes('«التثبيت»'), 'the integrations page, naming the dashboard page by its title');
});

test('T98: the guide’s Google Analytics event is the one the button pushes to the page’s Tag Manager', async () => {
  const { FORWARDED, shopAnalytics } = await import('../src/main');
  const dataLayer: Record<string, unknown>[] = [];
  shopAnalytics({ dataLayer })({ type: 'tryon_start', productId: '244167095' } as never);
  assert.ok(FORWARDED.includes('tryon_start'));
  assert.deepEqual(dataLayer, [{ event: 'tajribah_tryon_start', item_id: '244167095' }], 'its name, and the product’s id as item_id');
  const embed = source('Embed.tsx');
  assert.ok(embed.includes(`const TRYON_EVENT = '${dataLayer[0]!.event}'`), 'the install page names that event');
  assert.ok(/tajribah_\.\*/.test(embed) && 'tajribah_tryon_start'.match(/^tajribah_.*$/), 'and its trigger pattern catches it');
  const article = HELP_ARTICLES.find((a) => a.slug === 'salla-google-tag-manager')!;
  assert.ok(article.body.some((b) => b.ar.includes(String(dataLayer[0]!.event)) && b.ar.includes('item_id')), 'so does the help article');
});
