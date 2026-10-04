/** Light or dark: the device's choice unless the person picked one; the pick rides in a cookie the server reads. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { themeAttribute, themeCookie, themeFromCookie } from '@/lib/theme';

test('the device decides unless light or dark was picked; a pick survives in the cookie', () => {
  assert.equal(themeFromCookie(null), 'system');
  assert.equal(themeFromCookie('tajribah-lang=en'), 'system');
  assert.equal(themeFromCookie('tajribah-lang=en; tajribah-theme=dark'), 'dark');
  assert.equal(themeFromCookie('tajribah-theme=light'), 'light');
  assert.equal(themeFromCookie('tajribah-theme=purple'), 'system', 'anything else: the device');
  assert.equal(themeFromCookie('xtajribah-theme=dark'), 'system', 'another cookie’s name is not ours');
  assert.equal(themeFromCookie('tajribah-theme=darker'), 'system', 'only the exact value');
  assert.equal(themeAttribute('system'), undefined, 'no attribute: the stylesheet follows the device');
  assert.equal(themeAttribute('dark'), 'dark');
  for (const choice of ['light', 'dark'] as const) assert.equal(themeFromCookie(themeCookie(choice).split(';')[0]), choice, 'what is written is read back');
  assert.match(themeCookie('system'), /max-age=0/, 'back to the device clears the cookie');
});
