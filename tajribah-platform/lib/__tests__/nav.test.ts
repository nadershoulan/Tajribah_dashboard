import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_NAV, navGroupsFor, visibleNav } from '@/lib/nav';
import { ROLE_PERMISSIONS } from '@/lib/permissions';

const hrefs = (groups: ReturnType<typeof navGroupsFor>) => groups.flatMap((g) => g.items.map((i) => i.href));

test('the sidebar hides what a role cannot open', () => {
  for (const role of ['editor', 'analyst', 'viewer'] as const) {
    assert.ok(!hrefs(navGroupsFor(ROLE_PERMISSIONS[role])).includes('/dashboard/billing'), `${role} must not see Billing`);
  }
  assert.ok(hrefs(navGroupsFor(ROLE_PERMISSIONS.admin)).includes('/dashboard/billing'));
  assert.deepEqual(hrefs(navGroupsFor(ROLE_PERMISSIONS.owner)), ALL_NAV.map((i) => i.href), 'the owner sees everything');
});

test('a group with nothing the role may open is dropped, not shown empty', () => {
  const groups = navGroupsFor([]);
  assert.deepEqual(hrefs(groups), ['/dashboard'], 'no permissions → Home only');
  assert.equal(groups.length, 1);
});

test('the palette and the sidebar agree', () => {
  for (const perms of Object.values(ROLE_PERMISSIONS)) {
    assert.deepEqual(visibleNav(perms).map((i) => i.href), hrefs(navGroupsFor(perms)));
  }
});
