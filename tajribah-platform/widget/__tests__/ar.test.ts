import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arPath, detectDevice, sceneViewerIntent } from '../src/ar';
import { parseConfig, type ViewerConfig } from '../src/config';
import { GOOD } from './fixtures';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  android: 'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  desktop: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
};
const config = (over: Partial<ViewerConfig> = {}, model: Partial<ViewerConfig['model']> = {}): ViewerConfig =>
  ({ ...parseConfig(GOOD)!, placement: 'floor', ...over, model: { ...parseConfig(GOOD)!.model, usdz: 'https://cdn.example.test/m/v1/model.usdz', ...model } });
const PAGE = 'https://shop.example.sa/p/1?x=1';

test('devices: iPhone, an iPad that says it is a Mac, Android, desktop', () => {
  assert.deepEqual(detectDevice(UA.iphone, 5, true), { ios: true, quickLook: true, android: false });
  assert.deepEqual(detectDevice(UA.ipadDesktop, 5, true), { ios: true, quickLook: true, android: false }, 'iPadOS desktop mode');
  assert.deepEqual(detectDevice(UA.ipadDesktop, 0, false), { ios: false, quickLook: false, android: false }, 'a real Mac');
  assert.deepEqual(detectDevice(UA.android, 5, false), { ios: false, quickLook: false, android: true });
  assert.deepEqual(detectDevice(UA.desktop, 0, false), { ios: false, quickLook: false, android: false });
  assert.deepEqual(detectDevice('', 0, false), { ios: false, quickLook: false, android: false });
});

test('paths: Quick Look on iOS, Scene Viewer on Android, the viewer everywhere else', () => {
  const ios = detectDevice(UA.iphone, 5, true);
  const android = detectDevice(UA.android, 5, false);
  const desktop = detectDevice(UA.desktop, 0, false);
  assert.deepEqual(arPath(ios, config(), PAGE), { kind: 'quick-look', href: 'https://cdn.example.test/m/v1/model.usdz#allowsContentScaling=0' });
  assert.equal(arPath(ios, config({}, { usdz: null }), PAGE).kind, 'viewer', 'no USDZ: the in-page viewer');
  assert.equal(arPath({ ...ios, quickLook: false }, config(), PAGE).kind, 'viewer');
  assert.equal(arPath(android, config(), PAGE).kind, 'scene-viewer');
  assert.equal(arPath(desktop, config(), PAGE).kind, 'viewer');
  for (const placement of ['face', 'wrist'] as const) {
    assert.equal(arPath(ios, config({ placement }), PAGE).kind, 'viewer', `${placement}: try-on comes with P5`);
    assert.equal(arPath(android, config({ placement }), PAGE).kind, 'viewer');
  }
});

test('the Scene Viewer intent: true size, the product name, the page to come back to', () => {
  const href = sceneViewerIntent(config(), PAGE);
  assert.ok(href.startsWith('intent://arvr.google.com/scene-viewer/1.0?'));
  const query = new URLSearchParams(href.slice(href.indexOf('?') + 1, href.indexOf('#')));
  assert.equal(query.get('file'), 'https://cdn.example.test/m/v1/optimized.glb');
  assert.equal(query.get('resizable'), 'false', 'the real size is the product');
  assert.equal(query.get('mode'), 'ar_preferred');
  assert.equal(query.get('title'), 'أويستر 41');
  assert.equal(query.get('enable_vertical_placement'), null);
  assert.ok(href.includes(`S.browser_fallback_url=${encodeURIComponent(PAGE)};end;`));
  assert.ok(href.includes('package=com.google.android.googlequicksearchbox'));
  assert.equal(new URLSearchParams(sceneViewerIntent(config({ placement: 'wall' }), PAGE).split('?')[1].split('#')[0]).get('enable_vertical_placement'), 'true');
});
