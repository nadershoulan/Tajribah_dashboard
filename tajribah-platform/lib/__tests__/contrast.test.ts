/**
 * Accessibility (WCAG 2.1 AA 1.4.3): the colours small text is drawn in keep 4.5:1 against every light
 * surface they sit on — in the dashboard's and the website's stylesheets. Found wanting with axe-core
 * on 2026-09-30 (the brand aqua and the muted grey at 2.6–3.3:1 as text); the ink shades fixed it. A
 * later change to a token that brings one below 4.5:1 fails here, before any page does.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}
export const contrast = (a: string, b: string) => { const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m); return (x! + 0.05) / (y! + 0.05); };

/** The first `--name: #rrggbb;` in a stylesheet (the `:root` or scoped default). */
function token(css: string, name: string, scope?: string): string {
  const block = scope ? css.slice(css.indexOf(scope)) : css;
  const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(block);
  assert.ok(m, `--${name} is defined${scope ? ` in ${scope}` : ''}`);
  return m![1]!;
}

test('small text in the dashboard reads at 4.5:1 or more on every light surface', () => {
  const css = readFileSync(join(process.cwd(), 'app', 'dashboard.css'), 'utf8');
  const surfaces = ['#ffffff', token(css, 'bg'), token(css, 'tint')];
  for (const ink of ['text-3', 'aqua-ink', 'teal-ink', 'text-2']) {
    for (const surface of surfaces) assert.ok(contrast(token(css, ink), surface) >= 4.5, `--${ink} ${token(css, ink)} on ${surface}: ${contrast(token(css, ink), surface).toFixed(2)}`);
  }
  assert.ok(contrast(token(css, 'aqua'), '#ffffff') < 4.5, 'the brand aqua itself is for fills and icons, not small text — hence the ink shade');
});

test('small text on the website reads at 4.5:1 or more on every light surface', () => {
  const css = readFileSync(join(process.cwd(), '..', 'tajribah-try-on', 'app', 'site.css'), 'utf8');
  const surfaces = ['#ffffff', token(css, 'bg'), token(css, 'tint')];
  for (const ink of ['text-3', 'aqua-ink', 'teal-ink']) {
    const colour = token(css, ink, '.site {');
    for (const surface of surfaces) assert.ok(contrast(colour, surface) >= 4.5, `site --${ink} ${colour} on ${surface}: ${contrast(colour, surface).toFixed(2)}`);
  }
  assert.ok(contrast(token(css, 'text-2'), token(css, 'tint')) >= 4.5, '--text-2');
});

test("the try-on studio's small text takes the same ink shades (T61)", () => {
  const css = readFileSync(join(process.cwd(), '..', 'tajribah-try-on', 'app', 'site.css'), 'utf8');
  const surfaces = ['#ffffff', token(css, 'bg'), token(css, 'tint')];
  for (const ink of ['text-3', 'aqua-ink', 'teal-ink']) {
    const colour = token(css, ink, '.studio-root {');
    for (const surface of surfaces) assert.ok(contrast(colour, surface) >= 4.5, `studio --${ink} ${colour} on ${surface}: ${contrast(colour, surface).toFixed(2)}`);
  }
  for (const rule of ['.product-panel h1 em', '.privacy-note a', '.text-button:hover', '.download-button:hover']) {
    const body = css.slice(css.indexOf(rule + ' {'), css.indexOf('}', css.indexOf(rule + ' {')));
    assert.match(body, /color: var\(--aqua-ink\)/, `${rule} is text, so it uses the ink shade`);
  }
});
