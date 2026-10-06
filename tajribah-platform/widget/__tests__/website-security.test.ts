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

test('only the try-on frame may be framed, by https pages and (T85) the dashboard on this same address; local test servers only on this machine', () => {
  assert.deepEqual(directives(pageCsp('x'))['frame-ancestors'], ["'none'"]);
  assert.deepEqual(directives(pageCsp('x', { framed: true }))['frame-ancestors'], ["'self'", 'https:']);
  assert.ok(!pageCsp('x').includes('localhost'), 'a public page never names a local server');
  assert.ok(directives(pageCsp('x', { local: true }))['connect-src']!.includes('http://127.0.0.1:*'));
  // T95: a local test shop (plain http) may frame the try-on on this machine — and only here
  assert.ok(directives(pageCsp('x', { framed: true, local: true }))['frame-ancestors']!.includes('http://127.0.0.1:*'));
  assert.deepEqual(directives(pageCsp('x', { local: true }))['frame-ancestors'], ["'none'"], 'a page that is not the frame is never framed, even here');
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

test('T82: a phone on the same Wi-Fi counts as this computer — a private address only, never a public one', async () => {
  const { isLocalHost, isPrivateLanAddress } = await import('@site/lib/tryon-config');
  for (const host of ['localhost', '127.0.0.1', '192.168.1.20', '10.0.0.5', '172.16.0.9', '172.31.255.1']) assert.equal(isLocalHost(host), true, host);
  for (const host of ['8.8.8.8', '172.32.0.1', '172.15.0.1', '192.169.1.1', '11.0.0.1', '192.168.1.300', 'tajribah.com', '192.168.1.20.evil.com', '10.0.0.5.nip.io']) assert.equal(isLocalHost(host), false, host);
  assert.equal(isPrivateLanAddress('localhost'), false, 'a name is not a Wi-Fi address');
  const lan = directives(pageCsp('x', { local: true, lanHost: '192.168.1.20' }));
  assert.ok(lan['connect-src']!.includes('http://192.168.1.20:*') && lan['img-src']!.includes('http://192.168.1.20:*'), 'its own servers at that address');
  assert.ok(!directives(pageCsp('x'))['img-src']!.some((h) => h.startsWith('http://')), 'a public page: no http source at all');
});
