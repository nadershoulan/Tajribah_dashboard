/**
 * P7.7 — the security headers: every path gets them, pages get a nonce policy from the proxy,
 * the API gets a policy that allows nothing, and nothing can frame the app.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';
import nextConfig from '../../../../next.config';
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
  assert.doesNotMatch(scripts, /unsafe-inline|unsafe-eval|https?:|\*/, 'no inline, no eval, no hosts');
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /base-uri 'self'/);
  assert.doesNotMatch(directive(csp, 'connect-src'), /ws:/);
  const dev = pageCsp('abc123', { dev: true });
  assert.match(directive(dev, 'script-src'), /'unsafe-eval'/);
  assert.match(directive(dev, 'connect-src'), /ws:/);
});

test('the proxy gives each page its own nonce, on the request (for the renderer) and the response', () => {
  const first = proxy(new NextRequest('https://app.tajribah.sa/dashboard'));
  const second = proxy(new NextRequest('https://app.tajribah.sa/dashboard'));
  const policy = first.headers.get('content-security-policy') ?? '';
  const nonce = /'nonce-([^']+)'/.exec(policy)?.[1];
  assert.ok(nonce && nonce.length >= 22, 'a nonce of at least 128 bits');
  assert.notEqual(policy, second.headers.get('content-security-policy'), 'never reused');
  // How NextResponse.next({ request }) hands a changed request header to the renderer.
  assert.equal(first.headers.get('x-middleware-request-content-security-policy'), policy);
  assert.equal(newNonce().length, 24);
});

test('the proxy runs on pages, not on the API or static files', () => {
  const [matcher] = proxyConfig.matcher;
  const runs = (path: string) => new RegExp(`^${matcher}$`).test(path);
  for (const page of ['/', '/login', '/dashboard', '/dashboard/security', '/admin/stores']) assert.ok(runs(page), page);
  for (const other of ['/api/auth/me', '/brand/favicon.ico', '/assets/index.js']) assert.ok(!runs(other), other);
});
