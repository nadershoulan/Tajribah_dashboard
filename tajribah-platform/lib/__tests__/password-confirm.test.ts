/** Sign-up and a new password take the password twice; only an exact copy lets the form go. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PASSWORDS_DIFFER, passwordsDiffer } from '@/lib/password-confirm';

test('only an exact copy of the password passes', () => {
  assert.equal(passwordsDiffer('Tajribah-2026', 'Tajribah-2026'), false);
  assert.equal(passwordsDiffer('Tajribah-2026', ''), true, 'left empty: stopped, not skipped');
  assert.equal(passwordsDiffer('Tajribah-2026', 'tajribah-2026'), true, 'case counts');
  assert.equal(passwordsDiffer('Tajribah-2026', 'Tajribah-2026 '), true, 'a trailing space counts: the password is sent as typed');
  assert.ok(PASSWORDS_DIFFER.ar && PASSWORDS_DIFFER.en, 'said in both languages');
});
