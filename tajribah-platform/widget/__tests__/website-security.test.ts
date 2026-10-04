/**
 * P7.7 for the website — the shop-facing pages' policy (../tajribah-try-on/lib/security.ts): scripts only
 * by the page's nonce (no 'unsafe-inline'), framing only for the try-on frame, local test servers only
 * when the page itself is on this machine, and nothing beyond what the pages were seen to need.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { newNonce, pageCsp } from '@site/lib/security';
import { sitePath } from './site-path';

const directives = (csp: string) => Object.fromEntries(csp.split('; ').map((d) => { const [k, ...v] = d.split(' '); return [k!, v]; }));

test('scripts run only by the page’s nonce; WebAssembly compiles, JavaScript eval does not', () => {
  const d = directives(pageCsp('abc123'));
  assert.deepEqual(d['script-src'], ["'self'", "'nonce-abc123'", "'strict-dynamic'", "'wasm-unsafe-eval'"]);
  assert.ok(!pageCsp('x').includes("script-src 'self' 'unsafe-inline'"), 'never inline scripts');
  assert.ok(!d['script-src']!.includes("'unsafe-eval'"), 'no eval in a build');
  assert.ok(directives(pageCsp('x', { dev: true }))['script-src']!.includes("'unsafe-eval'"), 'the dev server only');
  assert.deepEqual(d['object-src'], ["'none'"]);
  assert.deepEqual(d['base-uri'], ["'self'"]);
  assert.deepEqual(d['form-action'], ["'self'"]);
  assert.deepEqual(d['connect-src'], ["'self'", 'blob:', 'data:', 'https://cfg.tajribah.com', 'https://cdn.tajribah.com', 'https://ev.tajribah.com'], 'the config host, the file host and the collector, nothing else');
  assert.notEqual(newNonce(), newNonce());
  assert.equal(atob(newNonce()).length, 16, '128 bits');
});

test('only the try-on frame may be framed, by https pages; local test servers only on this machine', () => {
  assert.deepEqual(directives(pageCsp('x'))['frame-ancestors'], ["'none'"]);
  assert.deepEqual(directives(pageCsp('x', { framed: true }))['frame-ancestors'], ['https:']);
  assert.ok(!pageCsp('x').includes('localhost'), 'a public page never names a local server');
  assert.ok(directives(pageCsp('x', { local: true }))['connect-src']!.includes('http://127.0.0.1:*'));
  const proxy = readFileSync(sitePath('proxy.ts'), 'utf8');
  assert.match(proxy, /framed: pathname\.startsWith\(["']\/embed\/["']\)/, 'framed means the try-on frame');
  assert.match(proxy, /local: isLocalHost\(hostname\)/, 'local means the page is on this machine');
  assert.match(proxy, /headers\.set\(["']content-security-policy["'], csp\)/, 'on the request too: that is where the renderer reads the nonce');
});

test('T68 analytics: Google may be reached only when a GA4 id is set, and never from the try-on frame', () => {
  const off = directives(pageCsp('x'))['connect-src']!;
  assert.ok(!off.some((h) => h.includes('google')), 'no id, no Google');
  const on = directives(pageCsp('x', { analytics: true }))['connect-src']!;
  assert.ok(on.includes('https://*.google-analytics.com') && on.includes('https://*.analytics.google.com'));
  assert.ok(!directives(pageCsp('x', { analytics: true, framed: true }))['connect-src']!.some((h) => h.includes('google')), 'the frame sits on a merchant’s page');
  assert.deepEqual(directives(pageCsp('x', { analytics: true }))['script-src'], ["'self'", "'nonce-x'", "'strict-dynamic'", "'wasm-unsafe-eval'"], 'the script still arrives only through the site’s own code');
  const proxy = readFileSync(sitePath('proxy.ts'), 'utf8');
  assert.match(proxy, /const analytics = pathname\.startsWith\(["']\/p\/["']\) \|\| \(await siteGaId\(\)\) !== null;/, 'T69: the id staff set, read at run time; a product page may carry its store’s');
  assert.match(proxy, /analytics \}\);/);
});
