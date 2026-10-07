/**
 * SEO, 2026-10-08 — what search engines read: robots.txt from an explicit route (the metadata-file form lost to
 * the dashboard's catch-all on the live site), the manifest, the root favicon, og:url on the home page, and
 * structured data with the brand only (no legal name, VAT number or address — Nader, 2026-10-08).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { robotsTxt, structuredData, webManifest } from '@site/lib/seo';
import { sitePath } from './site-path';

test('robots.txt: the site is crawled, the private parts are not, and the sitemap is named', () => {
  const txt = robotsTxt('https://tajribah.org');
  assert.match(txt, /^User-agent: \*$/m);
  assert.match(txt, /^Allow: \/$/m);
  for (const path of ['/api/', '/capture/', '/embed/', '/dashboard']) assert.match(txt, new RegExp(`^Disallow: ${path.replace(/\//g, '\/')}$`, 'm'), path);
  assert.match(txt, /^Sitemap: https:\/\/tajribah\.org\/sitemap\.xml$/m);
  assert.doesNotMatch(txt, /^Disallow: \/$/m, 'never the whole site');
  const route = readFileSync(sitePath('app/robots.txt/route.ts'), 'utf8');
  assert.match(route, /text\/plain/, 'served as text, not as a page');
  assert.ok(!existsSync(sitePath('app/robots.ts')), 'one robots.txt only — the metadata file would clash with the route');
});

test('the manifest: Arabic first, brand colours, both icons that exist', () => {
  const m = webManifest();
  assert.equal(m.lang, 'ar');
  assert.equal(m.dir, 'rtl');
  assert.equal(m.theme_color, '#0A2237');
  for (const icon of m.icons) assert.ok(existsSync(sitePath(`public${icon.src}`)), `${icon.src} exists`);
  assert.match(readFileSync(sitePath('app/(site)/layout.tsx'.replace('app/(site)/', 'app/')), 'utf8'), /manifest: '\/manifest\.webmanifest'/);
});

test('structured data names the brand and the site — and nothing about the company', () => {
  const data = structuredData('https://tajribah.org');
  assert.deepEqual(data.map((d) => d['@type']), ['Organization', 'WebSite']);
  assert.equal(data[1]!.name, 'تجربة');
  const all = JSON.stringify(data);
  for (const hidden of ['legalName', 'taxID', '314550511700003', '7033242079', 'SRO', 'Malqa', '13524']) assert.ok(!all.includes(hidden), `no ${hidden}`);
});

test('the home page carries og:url, and /favicon.ico exists at the root', () => {
  assert.match(readFileSync(sitePath('app/layout.tsx'), 'utf8'), /url: '\/',/);
  assert.ok(existsSync(sitePath('public/favicon.ico')));
});

test('the header offers sign-up beside the demo, on desktop and in the phone menu, as a plain link to /register', () => {
  const chrome = readFileSync(sitePath('components/site/chrome.tsx'), 'utf8');
  const head = chrome.slice(chrome.indexOf('<header'), chrome.indexOf('</header>'));
  const count = (needle: string) => head.split(needle).length - 1;
  assert.equal(count("{t('إنشاء حساب', 'Sign up')}"), 2, 'desktop and phone menu');
  assert.equal(count('/register`} className="btn btn-ghost'), 2, 'both go to /register, outlined beside the solid demo button');
  assert.ok(head.indexOf("'إنشاء حساب'") < head.indexOf("'جرّب العرض'"), 'beside the demo, before it');
});
