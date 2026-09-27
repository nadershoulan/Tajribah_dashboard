/**
 * P7 — the app's security headers are configured for every path, and framing is refused.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import nextConfig from '../../../../next.config';
import { SECURITY_HEADERS } from '@/server/core/http/security-headers';

test('every path gets the security headers, and nothing can frame the app', async () => {
  const rules = await nextConfig.headers!();
  const all = rules.find((r) => r.source === '/:path*');
  assert.ok(all, 'a rule for every path');
  assert.deepEqual(all.headers, SECURITY_HEADERS);
  const get = (k: string) => SECURITY_HEADERS.find((h) => h.key === k)?.value ?? '';
  assert.match(get('Content-Security-Policy'), /frame-ancestors 'none'/);
  assert.equal(get('X-Frame-Options'), 'DENY');
  assert.equal(get('X-Content-Type-Options'), 'nosniff');
  assert.match(get('Strict-Transport-Security'), /max-age=\d{7,}/);
  assert.match(get('Permissions-Policy'), /camera=\(\)/);
});
