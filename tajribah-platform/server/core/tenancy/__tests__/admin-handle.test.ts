/**
 * P0.5 — "`unsafeAdminDb` with a lint rule", enforced where it can run.
 *
 * The admin handle bypasses RLS (T9), so every file allowed to touch it is listed here with
 * the reason. The same list is in `eslint.config.mjs` as `no-restricted-imports`; this test
 * exists because lint cannot run on every machine and a rule nobody runs protects nothing.
 * Adding a file means adding a reason — in both places.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ADMIN_ALLOWED: Record<string, string> = {
  'db/client.ts': 'defines it',
  'server/core/tenancy/tenant-db.ts': 'the predicate layer: background jobs reach tenant data through TenantDb on the admin handle',
  'server/core/tenancy/context.ts': 'the membership lookup that precedes any tenant scope',
  'server/core/auth/session.ts': 'sessions are keyed by user and span every tenant the user can switch to',
  'server/modules/auth/service.ts': 'registration and login happen before a tenant is known',
  'server/modules/auth/two-factor.ts': 'two-step sign-in belongs to the account, which spans every store it can switch to',
  'server/modules/billing/trial.ts': 'the reminder sweep finds due trials across stores (ids and dates only); each reminder is written in its own store',
  'server/modules/billing/coupons.ts': 'coupon limits count redemptions across stores, and redemption locks the platform coupon row',
  'server/modules/billing/notices.ts': 'billing mail goes to the store’s owners and admins, whose addresses live on the global users table',
  'server/modules/admin/access.ts': 'the admin console: staff act across every store by definition; the staff trail is admin-role only',
  'server/modules/admin/overview.ts': 'platform-wide counts and revenue for staff (A2): read across every store',
  'server/modules/admin/stores.ts': 'staff list and inspect any store (A3), including a suspended one; reads only',
  'server/modules/admin/actions.ts': 'staff change a store (A4): the change, the store audit row and the staff trail in one admin transaction',
  'server/modules/admin/billing.ts': 'staff read subscriptions and invoices across every store (A7); reads only',
  'server/modules/admin/operations.ts': 'staff see queue, webhook and key-rotation health across the platform and retry a dead job (A11); jobs are platform rows',
  'server/modules/admin/support.ts': 'support looks up any store, person, invoice, job, delivery or request id across the platform (A12); reads only',
  'server/modules/admin/coupons.ts': 'staff write the coupon catalogue (A13), which the app role may only read; redemptions counted across stores',
  'server/modules/admin/staff-view.ts': 'staff point their own session at a store for a read-only view (A4b); sessions are platform rows; the store trail row is written with an explicit tenant',
  'server/modules/admin/privacy.ts': 'the privacy-request register and its fulfilment (A14, T22): a request about an account belongs to no store, and erasure reaches every store the person belongs to',
  'server/modules/admin/retention.ts': 'the retention sweep (A14, T22) deletes past-period rows across every store, including from append-only tables — the admin role keeps DML for exactly this',
  'server/modules/admin/announcements.ts': 'staff write the announcements catalogue (A13, T23), which the app role may only read',
  'server/modules/admin/plans.ts': 'staff change the platform plan catalogue (A6, T19): the rows, the reach count and the staff trail in one transaction',
  'server/modules/admin/users.ts': 'staff find people across every store and end their sessions or reset two-step sign-in (A5); users are not tenant-scoped',
  'server/core/jobs/queue.ts': 'the worker claims across tenants in one statement (RLS_EXEMPT: jobs)',
  'server/core/billing/entitlements.ts': 'subscription and membership counts are platform billing state, filtered by tenant explicitly',
  'server/modules/webhooks/ingest.ts': 'a delivery precedes any tenant scope: find the connection by provider + a store id the signature vouched for',
  'server/modules/team/service.ts': 'member names come from platform user accounts, filtered to this store\'s members; an invitee accepts before they are a member of any tenant scope',
  'server/modules/connections/rotation.ts': 'the key-rotation sweep finds connections sealed under an old key (ids only), then re-seals each inside withTenant',
  'server/modules/models/cleanup.ts': 'the draft sweep finds abandoned uploads across tenants (ids only), then fails each inside withTenant',
  'server/modules/sync/schedule.ts': 'the sync schedule reads due connections and stalled syncs across tenants (ids only), then acts inside withTenant',
  'server/modules/webhooks/dispatch.ts': 'the worker lists pending events across tenants (ids and tenants only), then handles each inside withTenant',
};

const APP_ALLOWED: Record<string, string> = {
  'db/client.ts': 'defines it',
  'server/core/tenancy/rls.ts': 'withTenant — the only way to open an RLS-scoped transaction',
};

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === 'node_modules' || entry === '__tests__' || entry.startsWith('.')) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(entry)) out.push(full);
  }
  return out;
}

function usersOf(identifier: string): string[] {
  const root = process.cwd();
  const found: string[] = [];
  for (const dir of ['app', 'components', 'lib', 'server', 'db', 'content', 'preview']) {
    let files: string[] = [];
    try { files = sourceFiles(join(root, dir)); } catch { continue; }
    for (const file of files) {
      // Code, not comments: strip line and block comments before looking.
      const code = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
      if (new RegExp(`\\b${identifier}\\b`).test(code)) found.push(relative(root, file).split(sep).join('/'));
    }
  }
  return found.sort();
}

test('only the listed files touch the RLS-bypassing admin handle', () => {
  const outside = usersOf('unsafeAdminDb').filter((file) => !ADMIN_ALLOWED[file]);
  assert.deepEqual(outside, [],
    'unsafeAdminDb() bypasses row-level security. Use withTenant(), or add the file to ADMIN_ALLOWED ' +
    '(here and in eslint.config.mjs) with the reason it cannot be tenant-scoped.');
});

test('only withTenant opens the RLS-bound app handle', () => {
  const outside = usersOf('appDb').filter((file) => !APP_ALLOWED[file]);
  assert.deepEqual(outside, [], 'appDb() is reached through withTenant(); a raw query on it with no tenant returns nothing.');
});

test('the allow-lists name files that exist and still need the handle', () => {
  const admin = new Set(usersOf('unsafeAdminDb'));
  for (const file of Object.keys(ADMIN_ALLOWED)) {
    assert.ok(admin.has(file), `${file} no longer uses unsafeAdminDb — remove it from ADMIN_ALLOWED so the list stays honest`);
  }
});
