/**
 * P1.18 — which AR path a tap takes, decided from the device and the config. Pure, so every
 * branch is tested without a phone.
 *
 *  - **iPhone / iPad with a USDZ** → Quick Look, straight from a `rel="ar"` link: native,
 *    instant, and no 200 KB viewer download. Content scaling is switched off — the product at
 *    its true size is the point.
 *  - **Android with a GLB** → Scene Viewer through an intent URL, `resizable=false` for the
 *    same reason; if Scene Viewer is missing, Android opens `browser_fallback_url` (this page).
 *  - **Everything else** (desktop, iPhone without a USDZ, face/wrist items until try-on in
 *    P5) → `<model-viewer>` in the page, which also offers WebXR where the browser has it.
 */
import type { ViewerConfig } from './config';

export type Device = { ios: boolean; quickLook: boolean; android: boolean };
export type ArPath =
  | { kind: 'quick-look'; href: string }
  | { kind: 'scene-viewer'; href: string }
  | { kind: 'viewer' };

/** What this browser can do, from what it reports. Defensive: any doubt means "viewer". */
export function detectDevice(userAgent: string, maxTouchPoints: number, anchorSupportsAr: boolean): Device {
  const ua = userAgent || '';
  // iPadOS reports a Mac user agent; touch points give it away.
  const ios = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  const android = /Android/.test(ua) && !ios;
  return { ios, quickLook: ios && anchorSupportsAr, android };
}

export function arPath(device: Device, config: ViewerConfig, pageUrl: string): ArPath {
  // Face and wrist are try-on anchors (P5); placing a watch on the floor would be wrong.
  const tryOn = config.placement === 'face' || config.placement === 'wrist';
  if (!tryOn && device.quickLook && config.model.usdz) {
    return { kind: 'quick-look', href: `${config.model.usdz}#allowsContentScaling=0` };
  }
  if (!tryOn && device.android) {
    return { kind: 'scene-viewer', href: sceneViewerIntent(config, pageUrl) };
  }
  return { kind: 'viewer' };
}

/** Google's documented Scene Viewer intent (developers.google.com/ar/develop/scene-viewer). */
export function sceneViewerIntent(config: ViewerConfig, pageUrl: string): string {
  const params = new URLSearchParams({
    file: config.model.glb,
    mode: 'ar_preferred',
    resizable: 'false',
    title: config.product.nameAr ?? config.product.name,
  });
  if (config.placement === 'wall') params.set('enable_vertical_placement', 'true');
  const fallback = encodeURIComponent(pageUrl);
  return `intent://arvr.google.com/scene-viewer/1.0?${params.toString()}`
    + `#Intent;scheme=https;package=com.google.android.googlequicksearchbox;action=android.intent.action.VIEW;S.browser_fallback_url=${fallback};end;`;
}
