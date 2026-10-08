/**
 * Nader, 2026-10-08: every password field lets the person see what they typed. Each one is `PasswordInput`
 * (components/dashboard/password-input.tsx) — a raw `type="password"` anywhere else ships without the eye.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { if (name !== '__tests__' && name !== 'node_modules') files(full, out); }
    else if (/\.tsx$/.test(name)) out.push(full);
  }
  return out;
}

test('every password field has the eye: no raw password input outside PasswordInput', () => {
  const root = process.cwd();
  const raw = files(join(root, 'components'))
    .filter((f) => !f.endsWith('password-input.tsx'))
    .filter((f) => /type=["']password["']|type=\{[^}]*'password'/.test(readFileSync(f, 'utf8')))
    .map((f) => relative(root, f));
  assert.deepEqual(raw, [], 'use PasswordInput instead');
  const component = readFileSync(join(root, 'components/dashboard/password-input.tsx'), 'utf8');
  assert.match(component, /aria-pressed=\{shown\}/, 'the eye says whether the password is shown');
  assert.match(component, /type=\{shown \? 'text' : 'password'\}/);
  for (const page of ['Login', 'Register', 'ResetPassword', 'Security', 'SsoSettings']) {
    assert.match(readFileSync(join(root, `components/pages/${page}.tsx`), 'utf8'), /<PasswordInput /, `${page} uses it`);
  }
});
