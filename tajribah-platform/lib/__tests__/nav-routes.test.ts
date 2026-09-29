/**
 * T52 — every sidebar and palette entry opens a real screen. "QR codes" was listed from the start
 * and led to "page not found"; a screen that waits on something says why on its own page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_NAV } from '@/lib/nav';
import { ROUTES } from '@/components/routes';

test('every sidebar entry has a screen of its own', () => {
  const missing = ALL_NAV.map((item) => item.href).filter((href) => !ROUTES[href]);
  assert.deepEqual(missing, [], 'these would open "page not found"');
});
