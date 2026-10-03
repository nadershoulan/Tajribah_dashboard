/**
 * T68 — site analytics (../tajribah-try-on/lib/analytics.ts, components/site/consent.tsx): GA4 with
 * Consent Mode v2, nothing fetched before the visitor accepts, ads always denied, the choice kept for
 * 12 months, and with no measurement id set nothing at all — no banner, no policy wording about it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANALYTICS_ON, CONSENT_DEFAULT, CONSENT_GRANTED, GA_CONFIG, measurementId, readChoice, storedChoice } from '../../../tajribah-try-on/lib/analytics';
import { COOKIES, PRIVACY } from '../../../tajribah-try-on/content/legal';

const site = (p: string) => readFileSync(join(process.cwd(), '..', 'tajribah-try-on', p), 'utf8');

test('only a real GA4 measurement id turns analytics on', () => {
  assert.equal(measurementId('G-AB12CD34EF'), 'G-AB12CD34EF');
  assert.equal(measurementId(' G-AB12CD34EF '), 'G-AB12CD34EF');
  for (const bad of [undefined, '', 'UA-12345-1', 'G-', 'g-ab12cd34', 'G-AB12"><script>', 'GTM-ABCD12']) assert.equal(measurementId(bad), null, String(bad));
  assert.equal(ANALYTICS_ON, false, 'no id is set in this repo');
});

test('the choice is kept for 12 months, then asked again; anything malformed asks again', () => {
  const now = Date.UTC(2026, 9, 3);
  assert.equal(readChoice(storedChoice('granted', now), now + 364 * 86_400_000), 'granted');
  assert.equal(readChoice(storedChoice('denied', now), now + 10), 'denied');
  assert.equal(readChoice(storedChoice('granted', now), now + 366 * 86_400_000), null);
  for (const bad of [null, '', 'granted', '{"choice":"yes","at":1}', '{"choice":"granted"}', '{']) assert.equal(readChoice(bad, now), null, String(bad));
});

test('Consent Mode v2: all denied by default; accepting grants analytics only, never ads', () => {
  assert.deepEqual(CONSENT_DEFAULT, { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'denied' });
  assert.deepEqual(CONSENT_GRANTED, { ...CONSENT_DEFAULT, analytics_storage: 'granted' });
  assert.equal(GA_CONFIG.allow_google_signals, false);
  assert.equal(GA_CONFIG.allow_ad_personalization_signals, false);
  assert.equal(GA_CONFIG.cookie_expires, 365 * 86_400, 'the 12 months the cookie policy states');
});

test('Google’s script is fetched only after the visitor accepts, and only by the website', () => {
  const consent = site('components/site/consent.tsx');
  const start = consent.slice(consent.indexOf('function startAnalytics'), consent.indexOf('function stopAnalytics'));
  assert.match(start, /googletagmanager|GA_SCRIPT_HOST/);
  const effect = consent.slice(consent.indexOf('useEffect('), consent.indexOf('}, []);'));
  assert.match(effect, /if \(choice === 'granted'\) startAnalytics\(\)/, 'on load, only a remembered yes starts it');
  assert.equal((consent.match(/(?<!function )startAnalytics\(\)/g) ?? []).length, 2, 'a remembered yes, or the accept button — nowhere else');
  assert.match(consent, /if \(!ANALYTICS_ON \|\| !open\) return null/, 'no id, no banner');
  assert.match(site('components/site/chrome.tsx'), /<ConsentBanner \/>/);
  for (const shopper of ['app/embed', 'app/capture', 'app/p']) {
    const files = (readdirSync(join(process.cwd(), '..', 'tajribah-try-on', shopper), { recursive: true }) as string[]).filter((f) => f.endsWith('.tsx'));
    assert.ok(files.length > 0, shopper);
    for (const f of files) assert.ok(!/Shell|consent|analytics/.test(site(`${shopper}/${f}`)), `${shopper}/${f} is a merchant's shopper page`);
  }
});

test('with no id the policies say there is no analytics; the wording for when it is on exists', () => {
  assert.ok(!COOKIES.sections.some((s) => s.id === 'analytics'));
  assert.match(COOKIES.summary.en, /No advertising cookies and no third-party tracking/);
  assert.ok(JSON.stringify(PRIVACY).includes('your language preference only'));
  const legal = site('content/legal.ts');
  assert.match(legal, /_ga and _ga_<id>: tell visits from the same browser apart, for 12 months/);
  assert.match(legal, /Cookie settings/);
});
