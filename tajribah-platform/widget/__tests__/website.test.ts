/**
 * T32 — the website (../tajribah-try-on) and this app say the same things: the shop script and its
 * attributes (the website's install snippet had drifted to a wrong address and an attribute the
 * script never reads), the sign-up the pricing page opens, and the plans' names.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ATTR, WIDGET_SRC } from '../src/main';
import { embedSnippet } from '../src/snippet';
import { PLANS } from '@/lib/plans';
import { COMPANY } from '../../../tajribah-try-on/lib/site';
import { MATRIX, PLANS as SITE_PLANS } from '../../../tajribah-try-on/lib/plans';

const site = (file: string) => readFileSync(join(process.cwd(), '..', 'tajribah-try-on', file), 'utf8');

test('the website gives the same install lines as the dashboard', () => {
  assert.equal(COMPANY.widgetSrc, WIDGET_SRC, 'the script address');
  const page = site('components/pages/Integrations.tsx');
  // The website's two lines, with its placeholders, must be the dashboard's own.
  assert.ok(page.includes('<div data-tajribah-product="{{ product.id }}"></div>'), 'the product line');
  assert.ok(page.includes('<script src="${COMPANY.widgetSrc}" data-tajribah-store="your-store-key" async></script>'), 'the script line');
  assert.equal(embedSnippet('your-store-key'), `<div ${ATTR.product}="{{ product.id }}"></div>\n<script src="${WIDGET_SRC}" ${ATTR.store}="your-store-key" async></script>`);
  assert.ok(!/data-lang=/.test(page), 'no attribute the script does not read');
});

test('"Start with this plan" opens this app\'s sign-up with the plan, and the plans are named alike', () => {
  assert.equal(COMPANY.appUrl, 'https://app.tajribah.sa', 'T32: the dashboard lives on app.tajribah.sa');
  const pricing = site('components/pages/Pricing.tsx');
  assert.ok(pricing.includes('`${COMPANY.appUrl}/register?plan=${p.id}`'), 'priced plans go to sign-up');
  assert.ok(site('app/robots.ts').length > 0);
  assert.deepEqual(
    SITE_PLANS.map((p) => [p.id, p.name.ar, p.name.en]),
    PLANS.map((p) => [p.code, p.name.ar, p.name.en]),
    'the same four plans, in the same order, with the same names in both languages',
  );
});

test('T33: what the pricing matrix promises per plan is what the dashboard enforces', () => {
  const row = (en: string) => {
    const found = MATRIX.find((r) => r.label.en === en);
    assert.ok(found, `no matrix row "${en}"`);
    return found.cells;
  };
  const has = (feature: string) => PLANS.map((p) => p.features.includes(feature));
  const yes = (cells: (boolean | { en: string })[]) => cells.map((c) => c !== false);
  assert.deepEqual(yes(row('True-size comparison')), has('size_comparison'), 'the studio compare mode, every plan');
  assert.deepEqual(yes(row('On-model view')), has('size_comparison'), 'the studio itself, every plan (set up in the dashboard on every plan)');
  assert.deepEqual(yes(row('AI virtual try-on')), has('virtual_tryon'), 'the shopper’s own photo, Pro and up');
  assert.deepEqual(yes(row('Catalogue sync')), has('salla'));
  assert.deepEqual(yes(row('White label')), has('white_label'));
  assert.deepEqual(yes(row('API access')), has('public_api'));
  assert.deepEqual(row('Analytics dashboard').map((c) => (typeof c === 'object' ? c.en : c)),
    PLANS.map((p) => (p.features.includes('full_analytics') ? 'Full' : p.features.includes('basic_analytics') ? 'Basic' : false)));
});
