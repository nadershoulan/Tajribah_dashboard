/**
 * T68 — site analytics (../tajribah-try-on/lib/analytics.ts, components/site/consent.tsx): GA4 with
 * Consent Mode v2, nothing fetched before the visitor accepts, ads always denied, the choice kept for
 * 12 months, and with no measurement id set nothing at all — no banner, no policy wording about it.
 *
 * T69 — the id is set from the admin console and read at run time from the config host
 * (lib/site-settings.ts); a store's own id reaches only its products' own pages, behind a banner that
 * names the store, with the choice kept per store. The widget hands its moments to the GA4 a shop
 * already runs.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONSENT_DEFAULT, CONSENT_GRANTED, ENV_GA_ID, GA_CONFIG, gaIdFromSettings, measurementId, readChoice, storedChoice } from '@site/lib/analytics';
import { forgetSiteSettings, siteGaId, SITE_SETTINGS_URL } from '@site/lib/site-settings';
import { cookiesDoc, privacyDoc } from '@site/content/legal';
import { hostedProductFrom } from '@site/lib/hosted-page';
import { createTracker } from '../src/track';
import { FORWARDED, shopAnalytics } from '../src/main';
import { sitePath } from './site-path';

const site = (p: string) => readFileSync(sitePath(p), 'utf8');

test('only a real GA4 measurement id turns analytics on', () => {
  assert.equal(measurementId('G-AB12CD34EF'), 'G-AB12CD34EF');
  assert.equal(measurementId(' G-AB12CD34EF '), 'G-AB12CD34EF');
  for (const bad of [undefined, '', 'UA-12345-1', 'G-', 'g-ab12cd34', 'G-AB12"><script>', 'GTM-ABCD12']) assert.equal(measurementId(bad), null, String(bad));
  assert.equal(ENV_GA_ID, null, 'no id is built into this repo');
});

test('the website reads the id staff set from the config host — once a minute, keeping the last answer when it cannot', async () => {
  forgetSiteSettings();
  const asked: string[] = [];
  let answer: () => Response = () => Response.json({ v: 1, ga4: 'G-TAJ1234567' });
  const fetchImpl = (async (url: string) => { asked.push(url); return answer(); }) as unknown as typeof fetch;
  const t0 = Date.UTC(2026, 9, 4);

  assert.equal(SITE_SETTINGS_URL, 'https://cfg.tajribah.org/v1/_site/settings.json');
  assert.equal(await siteGaId(fetchImpl, t0), 'G-TAJ1234567');
  assert.equal(await siteGaId(fetchImpl, t0 + 30_000), 'G-TAJ1234567');
  assert.equal(asked.length, 1, 'within a minute, not asked again');

  answer = () => { throw new Error('offline'); };
  assert.equal(await siteGaId(fetchImpl, t0 + 61_000), 'G-TAJ1234567', 'unreachable: the last answer stands');
  answer = () => new Response('busy', { status: 503 });
  assert.equal(await siteGaId(fetchImpl, t0 + 122_000), 'G-TAJ1234567', 'an error: the last answer stands');
  answer = () => Response.json({ v: 1, ga4: null });
  assert.equal(await siteGaId(fetchImpl, t0 + 183_000), null, 'switched off in the console: off');
  answer = () => Response.json({ v: 1, ga4: 'G-"><script>' });
  forgetSiteSettings();
  assert.equal(await siteGaId(fetchImpl, t0), null, 'a malformed id is no id');
  answer = () => new Response(null, { status: 404 });
  forgetSiteSettings();
  assert.equal(await siteGaId(fetchImpl, t0), ENV_GA_ID, 'never saved: the build’s id, if any');

  assert.equal(gaIdFromSettings({ v: 2, ga4: 'G-TAJ1234567' }), undefined, 'a shape this reader does not know is not an answer');
  assert.equal(gaIdFromSettings('G-TAJ1234567'), undefined);
  forgetSiteSettings();
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

test('Google’s script is fetched only after the visitor accepts — the website’s id on the website, a store’s own id on its products’ pages', () => {
  const consent = site('components/site/consent.tsx');
  const start = consent.slice(consent.indexOf('function startAnalytics'), consent.indexOf('function stopAnalytics'));
  assert.match(start, /googletagmanager|GA_SCRIPT_HOST/);
  const banner = consent.slice(consent.indexOf('export function ConsentBanner'), consent.indexOf('export function StoreConsent'));
  const store = consent.slice(consent.indexOf('export function StoreConsent'), consent.indexOf('export function ConsentLink'));
  for (const [name, part] of [['website', banner], ['store', store]] as const) {
    const effect = part.slice(part.indexOf('useEffect('), part.indexOf('}, ['));
    assert.match(effect, /if \(choice === 'granted'\) startAnalytics\(id\)/, `${name}: on load, only a remembered yes starts it`);
    assert.equal((part.match(/startAnalytics\(id\)/g) ?? []).length, 2, `${name}: a remembered yes, or the accept button — nowhere else`);
    assert.match(part, /if \(!id \|\| !open\) return null/, `${name}: no id, no banner`);
  }
  assert.match(banner, /const id = useGaId\(\)/, 'the website’s banner: the id staff set');
  assert.match(store, /const key = `\$\{CONSENT_KEY\}:\$\{id \?\? ''\}`/, 'a store’s banner: the choice kept per store');
  assert.match(store, /store\.ar\} خدمة Google Analytics/, 'it names the store that measures');
  assert.match(site('components/site/chrome.tsx'), /<ConsentBanner \/>/);
  assert.match(site('app/layout.tsx'), /<AnalyticsProvider id=\{gaId\}>/);
  assert.match(site('proxy.ts'), /pathname\.startsWith\(["']\/p\/["']\) \|\| \(await siteGaId\(\)\) !== null/);

  // The try-on frame and the phone page never load analytics; a product's page loads only its store's.
  for (const shopper of ['app/embed', 'app/capture', 'app/p']) {
    const files = (readdirSync(sitePath(shopper), { recursive: true }) as string[]).filter((f) => f.endsWith('.tsx'));
    assert.ok(files.length > 0, shopper);
    for (const f of files) assert.ok(!/Shell|consent|analytics|ConsentBanner/.test(site(`${shopper}/${f}`)), `${shopper}/${f} is a merchant's shopper page`);
  }
  const hosted = site('components/pages/HostedPage.tsx');
  assert.ok(!/ConsentBanner|useGaId/.test(hosted), 'never the website’s id on a store’s page');
  assert.match(hosted, /<StoreConsent id=\{p\.ga4\} store=\{p\.store\} \/>/);
  assert.ok(!/Consent|gtag/.test(site('components/pages/EmbedTryOn.tsx')), 'the try-on frame');
});

test('a store’s GA4 id reaches its product page only as a real measurement id', () => {
  const config = (ga4: unknown) => ({
    v: 1, product: { name: 'Oud lamp' }, placement: 'floor', model: { glb: 'https://cdn.tajribah.org/m.glb' },
    page: { store: { name: 'Oud', nameAr: 'عود' }, shopUrl: null, poweredBy: true, host: null, ga4 },
  });
  assert.equal(hostedProductFrom(config('G-OUD7654321'))?.ga4, 'G-OUD7654321');
  for (const bad of [null, undefined, 'UA-1-1', 'G-x"><script>', 42]) assert.equal(hostedProductFrom(config(bad))?.ga4, null, String(bad));
});

test('with no id the policies say there is no analytics; with one they name Google Analytics', () => {
  const off = cookiesDoc(false);
  assert.ok(!off.sections.some((s) => s.id === 'analytics'));
  assert.match(off.summary.en, /No advertising cookies and no third-party tracking/);
  assert.ok(JSON.stringify(privacyDoc(false)).includes('your language preference only'));
  const on = cookiesDoc(true);
  assert.ok(on.sections.some((s) => s.id === 'analytics'));
  assert.match(JSON.stringify(on), /_ga and _ga_<id>: tell visits from the same browser apart, for 12 months/);
  assert.match(JSON.stringify(on), /Cookie settings/);
  assert.ok(JSON.stringify(privacyDoc(true)).includes('only if you agree, usage statistics through Google Analytics'));
  assert.match(site('components/pages/Legal.tsx'), /privacyDoc\(useGaId\(\) !== null\)/);
});

test('the widget hands its moments to the GA4 a shop already runs — gtag, else a Tag Manager dataLayer — and only what it may send', () => {
  const gtagCalls: unknown[][] = [];
  const withGtag = { gtag: (...a: unknown[]) => { gtagCalls.push(a); } };
  const tracker = (consent: 'granted' | 'required', doNotTrack = false, win: object = withGtag) => createTracker({
    endpoint: 'https://ev.tajribah.org/v1/e', store: 'oud', sdk: 't', now: () => 1000, session: 's'.repeat(22),
    consent, doNotTrack, forward: shopAnalytics(win as never),
  });

  const t = tracker('granted');
  t.track({ type: 'ar_open', productId: 'p-1', properties: { surface: 'button' } });
  t.track({ type: 'product_view', productId: 'p-1' });
  t.track({ type: 'tryon_capture', productId: 'p-1' });
  assert.deepEqual(gtagCalls, [
    ['event', 'tajribah_ar_open', { surface: 'button', item_id: 'p-1' }],
    ['event', 'tajribah_tryon_capture', { item_id: 'p-1' }],
  ], 'the widget’s own moments; the shop measures its own product views');
  assert.deepEqual([...FORWARDED].sort(), ['ar_open', 'ar_place', 'tryon_capture', 'tryon_start']);

  gtagCalls.length = 0;
  tracker('required').track({ type: 'ar_open' });
  tracker('granted', true).track({ type: 'ar_open' });
  assert.equal(gtagCalls.length, 0, 'the shop’s consent switch and Do Not Track hold here too');

  const gtm = { dataLayer: [] as unknown[] };
  tracker('granted', false, gtm).track({ type: 'ar_place', productId: 'p-2' });
  assert.deepEqual(gtm.dataLayer, [{ event: 'tajribah_ar_place', item_id: 'p-2' }]);

  const nothing = {};
  assert.doesNotThrow(() => tracker('granted', false, nothing).track({ type: 'ar_open' }), 'no analytics on the shop: nothing happens');
  const broken = { gtag: () => { throw new Error('shop bug'); } };
  const safe = tracker('granted', false, broken);
  assert.doesNotThrow(() => safe.track({ type: 'ar_open' }));
  assert.equal(safe.pending(), 1, 'a broken shop tag never costs our own event');
  assert.equal(safe.dropped(), 0, 'nor is it counted as ours refused');
});
