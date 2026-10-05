/**
 * P7.7 — the security headers: every path gets them, pages get a nonce policy from the proxy,
 * the API gets a policy that allows nothing, and nothing can frame the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import nextConfig from '../../../../next.config';
import { matchHeaders } from 'vinext/config/config-matchers';
import { config as proxyConfig, proxy } from '../../../../proxy';
import { API_CSP, SECURITY_HEADERS, newNonce, pageCsp } from '@/server/core/http/security-headers';

const directive = (csp: string, name: string) => csp.split(';').map((d) => d.trim()).find((d) => d.startsWith(`${name} `)) ?? '';

test('every path gets the security headers, the API a policy that allows nothing', async () => {
  const rules = await nextConfig.headers!();
  assert.deepEqual(rules.find((r) => r.source === '/:path*')?.headers, SECURITY_HEADERS);
  assert.deepEqual(rules.find((r) => r.source === '/api/:path*')?.headers, [{ key: 'Content-Security-Policy', value: API_CSP }]);
  assert.match(API_CSP, /default-src 'none'/);
  assert.match(API_CSP, /frame-ancestors 'none'/);
  const get = (k: string) => SECURITY_HEADERS.find((h) => h.key === k)?.value ?? '';
  assert.equal(get('X-Frame-Options'), 'DENY');
  assert.equal(get('X-Content-Type-Options'), 'nosniff');
  assert.match(get('Strict-Transport-Security'), /max-age=\d{7,}/);
  assert.match(get('Permissions-Policy'), /camera=\(\)/);
});

test('the page policy holds scripts to the nonce; dev allowances never reach a build', () => {
  const csp = pageCsp('abc123');
  const scripts = directive(csp, 'script-src');
  assert.match(scripts, /'nonce-abc123'/);
  assert.match(scripts, /'strict-dynamic'/);
  assert.doesNotMatch(scripts, /unsafe-inline|'unsafe-eval'|https?:|\*/, 'no inline, no eval, no hosts');
  assert.match(scripts, /'wasm-unsafe-eval'/, 'WebAssembly may compile (the meshopt decoder), JavaScript eval may not');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.doesNotMatch(directive(csp, 'connect-src'), /ws:/);
  const dev = pageCsp('abc123', { dev: true });
  assert.match(directive(dev, 'script-src'), /'unsafe-eval'/);
  assert.match(directive(dev, 'connect-src'), /ws:/);
  assert.doesNotMatch(directive(csp, 'connect-src'), /127\.0\.0\.1|localhost/, 'a real address never names a local server');
  assert.match(directive(pageCsp('abc123', { local: true }), 'connect-src'), /http:\/\/127\.0\.0\.1:\*/, 'this computer: its own storage');
});

test('T79: products’ own pictures load from any https host (their store’s CDN); never plain http, and scripts stay held to the nonce', () => {
  const img = directive(pageCsp('abc123'), 'img-src');
  assert.match(img, /https:/);
  assert.doesNotMatch(img, /http:(?!\/\/)|\*/, 'not http:, not a wildcard');
  assert.doesNotMatch(directive(pageCsp('abc123'), 'script-src'), /https:/);
});

test('only a page served from this computer may upload to storage on it', async () => {
  const at = async (url: string) => directive((await proxy(new NextRequest(url))).headers.get('content-security-policy') ?? '', 'connect-src');
  assert.match(await at('http://127.0.0.1:8799/dashboard/tryon'), /http:\/\/127\.0\.0\.1:\*/);
  assert.doesNotMatch(await at('https://app.tajribah.sa/dashboard/tryon'), /127\.0\.0\.1|localhost/);
});

test('the proxy gives each page its own nonce, on the request (for the renderer) and the response', async () => {
  const first = await proxy(new NextRequest('https://app.tajribah.sa/dashboard'));
  const second = await proxy(new NextRequest('https://app.tajribah.sa/dashboard'));
  const policy = first.headers.get('content-security-policy') ?? '';
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  assert.ok(nonce && nonce.length >= 22, 'a nonce of at least 128 bits');
  assert.notEqual(policy, second.headers.get('content-security-policy'), 'never reused');
  // How NextResponse.next({ request }) hands a changed request header to the renderer.
  assert.equal(first.headers.get('x-middleware-request-content-security-policy'), policy);
  assert.equal(newNonce().length, 24);
});

test('one page may be framed — the Salla app page, by Salla’s merchant dashboard only (T61)', async () => {
  const policy = async (path: string) => (await proxy(new NextRequest(`https://app.tajribah.sa${path}`))).headers.get('content-security-policy') ?? '';
  assert.equal(directive(await policy('/salla/app'), 'frame-ancestors'), 'frame-ancestors https://s.salla.sa');
  assert.equal(directive(await policy('/salla/app/'), 'frame-ancestors'), 'frame-ancestors https://s.salla.sa');
  for (const path of ['/dashboard', '/salla', '/salla/app/x', '/dashboard/connections', '/login']) {
    assert.equal(directive(await policy(path), 'frame-ancestors'), "frame-ancestors 'none'", path);
  }
  assert.equal(directive(pageCsp('n', { framedBy: 'https://s.salla.sa' }), 'script-src'), directive(pageCsp('n'), 'script-src'), 'framed or not, scripts are held to the nonce');
});

test('the proxy runs on pages, not on the API or static files', () => {
  const [matcher] = proxyConfig.matcher;
  const runs = (path: string) => new RegExp(`^${matcher}$`).test(path);
  for (const page of ['/', '/login', '/dashboard', '/dashboard/security', '/admin/stores']) assert.ok(runs(page), page);
  for (const other of ['/api/auth/me', '/brand/favicon.ico', '/assets/index.js']) assert.ok(!runs(other), other);
});

test('as vinext serves them: first matching rule wins per header, and the home page `/` is covered too', async () => {
  const rules = await nextConfig.headers!();
  // vinext keeps the first value of each header (Next.js keeps the last), and reads `/:path*` as
  // one segment or more — so `/` needs its own rule (found on the try-on site's build, P5.12).
  const served = (path: string) => {
    const out = new Map<string, string>();
    for (const h of matchHeaders(path, rules as never, { headers: new Headers(), cookies: {}, query: new URLSearchParams(), host: 'app.tajribah.com' } as never)) if (!out.has(h.key.toLowerCase())) out.set(h.key.toLowerCase(), h.value);
    return out;
  };
  for (const path of ['/', '/dashboard', '/dashboard/tryon', '/admin', '/brand/logo.png', '/api/tryon', '/demo', '/embed/try-on', '/p/oud/sa-77']) {
    const got = served(path);
    // The website's pages may use the camera on this origin (the try-on's "on me"); nothing else may.
    const site = ['/', '/demo', '/embed/try-on', '/p/oud/sa-77'].includes(path);
    for (const { key, value } of SECURITY_HEADERS) {
      const expected = site && key === 'Permissions-Policy' ? 'camera=(self), microphone=(), geolocation=(), payment=()' : value;
      assert.equal(got.get(key.toLowerCase()), expected, `${path}: ${key}`);
    }
  }
  assert.equal(served('/api/tryon').get('content-security-policy'), API_CSP, 'the API keeps its own policy');
  assert.equal(served('/dashboard').get('content-security-policy'), undefined, 'pages take theirs from the proxy, with a nonce');
});

test('the website’s pages keep the website’s policy; the dashboard’s keep the dashboard’s (the website moved in)', async () => {
  const policy = async (path: string) => (await proxy(new NextRequest(`https://tajribah.sa${path}`))).headers.get('content-security-policy') ?? '';
  // The website's: the config host for the try-on, and /embed framed by any https shop.
  for (const path of ['/', '/pricing', '/demo', '/p/oud/sa-77']) assert.match(directive(await policy(path), 'connect-src'), /cfg\.tajribah\.com/, path);
  assert.equal(directive(await policy('/embed/try-on'), 'frame-ancestors'), "frame-ancestors 'self' https:", 'any https shop, and (T85) the dashboard on this same address');
  // The dashboard's: none of the website's hosts.
  for (const path of ['/dashboard', '/login', '/admin']) assert.doesNotMatch(directive(await policy(path), 'connect-src'), /cfg\.tajribah\.com/, path);
});
