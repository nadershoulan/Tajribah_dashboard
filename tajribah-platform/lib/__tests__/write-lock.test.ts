/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * T50 — a store that cannot be changed locks its screens' change buttons: a read-only store (the
 * trial or the subscription ended) and a staff view. The store in question is the session's current one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { lockOf } from '@/components/dashboard/write-lock';

const store = (id: string, readOnly: string | null) => ({ id, name: id, slug: id, plan: 'growth', status: 'active', trialEndsAt: null, logoUrl: null, role: 'owner', readOnly });
const me = (over: Record<string, unknown>) => ({ user: { id: 'u' }, currentTenantId: 'a', tenants: [store('a', null), store('b', 'trial_ended')], staffView: null, ...over }) as any;

test('locked for the current store when it is read-only, and for any staff view; open otherwise', () => {
  assert.equal(lockOf(me({})), null, 'a writable store');
  assert.equal(lockOf(me({ currentTenantId: 'b' })), 'read_only', 'the trial ended');
  assert.equal(lockOf(me({ tenants: [store('a', 'subscription_ended')] })), 'read_only', 'the subscription ended');
  assert.equal(lockOf(me({ staffView: { storeId: 'a', until: '2026-10-01T00:00:00Z' } })), 'staff_view', 'staff only look');
  assert.equal(lockOf(null), null, 'signed out: nothing to lock (the session guard handles it)');
});
