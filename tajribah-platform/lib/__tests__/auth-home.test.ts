/**
 * Nader, 2026-10-08: every sign-in screen has a way back to the website — the shared row (`AuthTop`) with a
 * plain link to "/" (the website, outside the dashboard's routes), beside the language switch.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const PAGES = join(process.cwd(), 'components/pages');

test('every auth screen carries the row with the way home', () => {
  for (const name of ['Login.tsx', 'Register.tsx', 'ResetPassword.tsx', 'VerifyEmail.tsx', 'InviteAccept.tsx', 'LoginSso.tsx']) {
    assert.match(readFileSync(join(PAGES, name), 'utf8'), /<AuthTop \/>/, `${name} has the way home`);
  }
  const top = readFileSync(join(PAGES, 'AuthTop.tsx'), 'utf8');
  assert.match(top, /<a href="\/"/, 'a plain link to the website root');
  assert.match(top, /العودة إلى الرئيسية/);
  assert.match(top, /<LangToggle \/>/, 'the language switch stays');
});
