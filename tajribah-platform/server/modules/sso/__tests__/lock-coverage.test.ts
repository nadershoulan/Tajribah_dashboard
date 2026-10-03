/**
 * P8 — the single sign-on lock cannot be forgotten. An endpoint that works for the store goes
 * through `tenantContextFor`, which holds an SSO session to its store. One that authenticates on its
 * own acts on the *account*, so it must either refuse an SSO session (`requireOwnSignIn`) or be listed
 * here with the reason it is safe. A new such endpoint fails this test until someone decides.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/** Account-level endpoints an SSO session may use, and why. */
const SAFE_FOR_SSO: Record<string, string> = {
  meHandler: 'lists only the SSO store (filtered by ssoTenantId)',
  switchTenantHandler: 'setSessionTenant refuses any store but the SSO one',
  resendVerificationHandler: 'sends a link to the person’s own address; changes nothing',
  twoFactorStatusHandler: 'reads whether two-step sign-in is on; changes nothing',
  endStaffViewHandler: 'only ends a staff view; an SSO session never starts one (the console refuses it)',
  announcementsHandler: 'platform notices every signed-in person sees',
  googleAvailableHandler: 'says only whether Google sign-in is set up; changes nothing (T69). Starting it goes through the store or staff checks',
  storesOverviewHandler: 'lists only the SSO store (onlyTenantId = ssoTenantId), as meHandler does; reads, changes nothing (T62)',
};

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === '__tests__' ? [] : files(path);
    return path.endsWith('.ts') ? [path] : [];
  });
}

test('every endpoint that authenticates by itself refuses an SSO session, or says why it need not', () => {
  const root = join(process.cwd(), 'server', 'modules');
  const found: string[] = [];
  for (const file of files(root)) {
    const source = readFileSync(file, 'utf8');
    const blocks = source.split(/\nexport const /).slice(1);
    for (const block of blocks) {
      const name = /^(\w+)/.exec(block)?.[1] ?? '';
      if (!/= route\(/.test(block.slice(0, 200)) || !/\bauthenticate\(/.test(block)) continue;
      if (/\b(tenantContextFor|staffContextFor)\(/.test(block)) continue; // both hold the lock themselves
      found.push(name);
      assert.ok(/\brequireOwnSignIn\(/.test(block) || name in SAFE_FOR_SSO,
        `${relative(process.cwd(), file)}: ${name} authenticates by itself but neither refuses an SSO session (requireOwnSignIn) nor is in SAFE_FOR_SSO`);
    }
  }
  assert.ok(found.length >= 8, `the scan found the account endpoints (${found.join(', ')})`);
  for (const name of Object.keys(SAFE_FOR_SSO)) assert.ok(found.includes(name), `${name} is listed as safe but no longer exists — remove it`);
});

test('the store-level and staff entry points hold the lock themselves', () => {
  const api = readFileSync(join(process.cwd(), 'server/core/http/api.ts'), 'utf8');
  const tenantContext = api.slice(api.indexOf('export async function tenantContextFor'));
  assert.match(tenantContext.slice(0, 600), /caller\.ssoTenantId && caller\.tenantId !== caller\.ssoTenantId/);
  const access = readFileSync(join(process.cwd(), 'server/modules/admin/access.ts'), 'utf8');
  const staff = access.slice(access.indexOf('export async function staffContextFor'));
  assert.match(staff.slice(0, 400), /requireOwnSignIn\(caller\)/);
});
