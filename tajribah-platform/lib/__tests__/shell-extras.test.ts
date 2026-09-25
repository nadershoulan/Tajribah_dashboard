import { test } from 'node:test';
import assert from 'node:assert/strict';
import { containsFilter } from '@/components/dashboard/command-palette';
import { demoSource } from '@/lib/data';
import { visibleNav } from '@/lib/nav';
import { ROLE_PERMISSIONS } from '@/lib/permissions';

test('palette filter: plain contains, any case, Arabic too — never fuzzy', () => {
  assert.equal(containsFilter('المنتجات Products', 'prod'), 1);
  assert.equal(containsFilter('المنتجات Products', 'المنتج'), 1);
  assert.equal(containsFilter('ربط المتجر Store connections', 'rose'), 0, 'r…o…s…e in order is not a match');
  assert.equal(containsFilter('Report settings', 'rose'), 0, 'a subsequence (r-o-s-e) is not a match either');
  assert.equal(containsFilter('anything', '   '), 1);
});

test('the palette offers only the screens a role may open', () => {
  const hrefs = (role: keyof typeof ROLE_PERMISSIONS) => visibleNav(ROLE_PERMISSIONS[role]).map((i) => i.href);
  assert.ok(hrefs('owner').includes('/dashboard/billing'));
  assert.ok(!hrefs('viewer').includes('/dashboard/billing'), 'a viewer has no billing:read');
  assert.ok(hrefs('viewer').includes('/dashboard/products'));
  assert.ok(hrefs('owner').length > hrefs('viewer').length);
});

test('the preview bell: unread count, mark one, mark all', async () => {
  const first = await demoSource.notifications();
  assert.equal(first.unread, first.items.filter((n) => !n.read).length);
  const one = first.items.find((n) => !n.read)!;
  await demoSource.markNotificationsRead([one.id]);
  assert.equal((await demoSource.notifications()).unread, first.unread - 1);
  await demoSource.markNotificationsRead('all');
  assert.equal((await demoSource.notifications()).unread, 0);
});
