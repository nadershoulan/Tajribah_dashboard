import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseConfig } from '../src/config';
import { configUrl, guard, loadConfig } from '../src/main';

import { GOOD } from './fixtures';
const tweak = (path: string, value: unknown) => {
  const copy = JSON.parse(JSON.stringify(GOOD));
  const keys = path.split('.');
  let at = copy;
  for (const k of keys.slice(0, -1)) at = at[k];
  if (value === undefined) delete at[keys.at(-1)!]; else at[keys.at(-1)!] = value;
  return copy;
};

test('config v1: a good one parses; anything off is null, never a throw', () => {
  assert.equal(parseConfig(GOOD)?.button.labelEn, 'View in your space');
  const bad: [string, unknown][] = [
    ['v', 2], ['v', undefined], ['model.glb', 'http://cdn.example.test/m.glb'], ['model.glb', 'javascript:alert(1)'],
    ['model.glb', undefined], ['model.usdz', 'ftp://x/y.usdz'], ['model.glbNative', 'http://cdn.example.test/native.glb'], ['model.glbNative', 7], ['button.color', 'red'], ['button.color', '#0B7A75; background:url(x)'],
    ['button.radius', 99], ['button.variant', 'ghost'], ['button.labelAr', 'x'.repeat(41)], ['placement', 'ceiling'],
    ['scale', 9], ['shadow', -1], ['product.widthMm', 5000], ['product.name', ''],
  ];
  for (const [path, value] of bad) assert.equal(parseConfig(tweak(path, value)), null, `${path}=${JSON.stringify(value)} must be refused`);
  for (const junk of [null, undefined, 'x', 42, [], { v: 1 }]) assert.equal(parseConfig(junk), null);
});

test('loading a config fails closed: 404, bad JSON, a bad config, a network error or a slow edge → null', async () => {
  const reply = (status: number, body: unknown): typeof fetch => async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status });
  assert.equal((await loadConfig('https://x/c.json', reply(200, GOOD)))?.v, 1);
  assert.equal(await loadConfig('https://x/c.json', reply(404, GOOD)), null);
  assert.equal(await loadConfig('https://x/c.json', reply(200, '{not json')), null);
  assert.equal(await loadConfig('https://x/c.json', reply(200, tweak('v', 2))), null);
  assert.equal(await loadConfig('https://x/c.json', async () => { throw new TypeError('network'); }), null);
  const hang: typeof fetch = (_url, init) => new Promise((_, reject) => init!.signal!.addEventListener('abort', () => reject(new Error('aborted'))));
  const started = Date.now();
  // Bounded here too: without the widget's own timeout this would wait forever, not fail.
  const bounded = Promise.race([loadConfig('https://x/c.json', hang, 50), new Promise((r) => setTimeout(() => r('still waiting'), 2000))]);
  assert.equal(await bounded, null, 'the widget must give up by itself');
  assert.ok(Date.now() - started < 1000, 'gives up at the timeout');
  let seen: RequestInit | undefined;
  await loadConfig('https://x/c.json', async (_u, init) => { seen = init; return new Response('{}'); });
  assert.equal(seen?.credentials, 'omit', "never sends the shop's cookies to us");
});

test('config URLs are escaped; guard swallows throws and rejections', async () => {
  assert.equal(configUrl('https://cfg.test/v1/', 'store key', 'p/../1?x'), 'https://cfg.test/v1/store%20key/p%2F..%2F1%3Fx.json');
  assert.equal(await guard(() => { throw new Error('boom'); }), undefined);
  assert.equal(await guard(async () => { throw new Error('boom'); }), undefined);
  assert.equal(await guard(() => 7), 7);
});

test('the built widget is one self-contained file under 60 KB gzipped', () => {
  const run = spawnSync(process.execPath, ['widget/build.mjs', '--modules', 'node_modules'], { encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr || run.stdout);
  const kb = Number(run.stdout.match(/([\d.]+) KB gzipped/)![1]);
  assert.ok(kb < 60, `${kb} KB gzipped`);
  const code = readFileSync('widget/dist/widget.js', 'utf8');
  assert.ok(!/\bimport\s*\(|\brequire\(/.test(code.replace(/type="module"|\.type="module"/g, '')), 'no runtime imports: the viewer loads by script tag, on tap');
});

test('T104: the minimal button is a style the config may carry — and anything else is still refused', () => {
  const at = (variant: unknown) => parseConfig({ ...GOOD, button: { ...GOOD.button, variant } })?.button.variant ?? null;
  assert.deepEqual(['minimal', 'solid', 'outline'].map(at), ['minimal', 'solid', 'outline']);
  for (const bad of ['ghost', '', null, 'Minimal']) assert.equal(at(bad), null, String(bad));
});

test('T125: through Google Tag Manager the script arrives with its src only — the settings come from its address', async () => {
  const { settingsOf } = await import('../src/main');
  const { tagManagerSnippet } = await import('../src/snippet');
  /** A document whose running script has only what Tag Manager keeps: `src` (no data- attributes). */
  const page = (src: string, attrs: Record<string, string> = {}) => ({
    baseURI: 'https://failet.sa/ar/p1',
    currentScript: { getAttribute: (n: string) => (n === 'src' ? src : attrs[n] ?? null) },
    querySelector: () => null,
  }) as unknown as Document;
  // the tag the install page gives, as the browser will read its src (&amp; becomes &)
  const given = /src="([^"]+)"/.exec(tagManagerSnippet('owner-3', { spot: 'options', consent: true }))![1]!.replace(/&amp;/g, '&');
  const s = settingsOf(page(given))!;
  assert.deepEqual([s.store, s.auto, s.spot, s.consent], ['owner-3', 'salla', 'options', 'required']);
  assert.equal(s.configBase, settingsOf(page('https://cdn.tajribah.org/w/v1/widget.js', { 'data-tajribah-store': 'x' }))!.configBase, 'where parts load from never comes from the address');
  // the template's script, with attributes, still works; attributes win over the address
  assert.equal(settingsOf(page('https://cdn.tajribah.org/w/v1/widget.js?store=other', { 'data-tajribah-store': 'failet' }))!.store, 'failet');
  // nothing to go on, or a key that is not a key: no settings, no button
  assert.equal(settingsOf(page('https://cdn.tajribah.org/w/v1/widget.js')), null);
  assert.equal(settingsOf(page('https://cdn.tajribah.org/w/v1/widget.js?store=%3Cscript%3E')), null);
});
