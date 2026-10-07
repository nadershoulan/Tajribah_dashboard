/**
 * T100/T101 — the try-on in a shop's popup fits its window (nothing to scroll), and carries a small mark that
 * opens Tajribah's website — except under white-label, where the store's own name stands alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { COMPANY } from '@site/lib/site';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const css = read('site/styles/site.css');
/** The declarations of one rule, as written. */
const rule = (selector: string) => {
  const at = css.indexOf(`${selector} {`);
  assert.ok(at >= 0, `a rule for ${selector}`);
  return css.slice(at, css.indexOf('}', at));
};

test('the popup view fits its window: the page does not scroll, the stage takes what is left, nothing is repeated', () => {
  const root = rule('.embed-root.is-popup');
  for (const d of ['height: 100dvh', 'display: flex', 'flex-direction: column', 'overflow: hidden']) assert.ok(root.includes(d), `the popup page: ${d}`);
  const stage = rule('.embed-root.is-popup .stage');
  assert.ok(stage.includes('flex: 1 1 auto') && stage.includes('aspect-ratio: auto') && stage.includes('max-height:'), 'the stage fills what is left, never taller than its picture');
  assert.ok(rule('.embed-root.is-popup .studio-panel').includes('min-width: 0'), 'a narrow phone: the studio shrinks to the window, nothing cut at the edge');
  assert.ok(rule('.embed-root.is-popup .studio-topbar').includes('flex-wrap: wrap'), 'and its icons go under the tabs');
  assert.ok(rule('.embed-root.is-popup .stage:has(.personal-empty)').includes('max-height: none'), 'the “on me” card is not cut by the picture’s height');
  assert.ok(rule('.embed-root.is-popup .studio-footer').includes('display: none'), 'the line the bar already says is not repeated');
});

test('T101: a small mark opens Tajribah’s website in a new tab — not under white-label', () => {
  const page = read('site/components/pages/EmbedTryOn.tsx');
  assert.ok(page.includes('href={`${COMPANY.siteUrl}/?utm_source=tryon&utm_medium=watermark`}'), 'Tajribah’s own address (the site’s setting), tagged as the try-on’s');
  assert.match(page, /className="embed-brand embed-watermark"[^>]*target="_blank" rel="noopener"/, 'in a new tab: the shopper keeps the product page');
  assert.match(page, /\{brand \? <span className="embed-brand"><StoreMark brand=\{brand\} \/><\/span> : \(/, 'a white-label store’s own name, with no link to Tajribah');
  assert.ok(/^https:\/\//.test(COMPANY.siteUrl));
  assert.ok(rule('.embed-watermark').includes('font-size: 13px'), 'small');
});
