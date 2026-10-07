#!/usr/bin/env node
/**
 * T95 — try the Google Tag Manager install on this computer, on your store's real product pages, before
 * touching Tag Manager. A small shop server serves any page of your store (read live from its public
 * address, its own scripts left out) with Tajribah's tag added the way Tag Manager adds a Custom HTML
 * tag: a script element created after the page loads, with no placeholder in the page.
 *
 *   node widget/build.mjs                                          (once: the widget the shop loads)
 *   node scripts/dev/test-shop.mjs --store <store key> --from https://your-store.sa
 *   then open http://127.0.0.1:8812/ar/<anything>/p<product number>   (a product you published)
 *
 * The store key is the one in your tag («التركيب في متجرك»). The dashboard must be running
 * (http://127.0.0.1:8799). Only for this computer: the settings the button reads come from the local
 * dashboard, whose pictures are on plain http here — the widget takes https only, so this server reads
 * those local links as https for the button's check (the try-on frame itself reads the real settings).
 *
 * T100: the page looks and behaves as the store's own — the platform's scripts run (Salla's menus, gallery,
 * add-to-cart bar), Cloudflare's Rocket Loader undone so they run in order. But nothing is measured from this
 * computer: a Content-Security-Policy lets scripts load only from the platform's file hosts (and the payment
 * providers whose boxes Salla shows: instalments, Apple Pay) and calls reach only its storefront API, so the
 * store's Tag Manager, Google Analytics, pixels, heatmaps, Cloudflare's beacon and any other outside script
 * are blocked before they start. `--still` serves a copy without any script.
 *   --spot options   the button under the product's options instead of under its picture (the tag's choice)
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > -1 ? process.argv[i + 1] : fallback; };
const store = arg('--store');
const from = arg('--from');
const port = Number(arg('--port', '8812'));
const dashboard = arg('--dashboard', 'http://127.0.0.1:8799');
const still = process.argv.includes('--still');
const spot = arg('--spot', 'image') === 'options' ? 'options' : 'image';
if (!store || !/^[a-z0-9-]{1,64}$/i.test(store) || !from || !/^https:\/\/[^/]+$/.test(from)) {
  console.error('usage: node scripts/dev/test-shop.mjs --store <store key> --from https://your-store.sa');
  process.exit(1);
}
const widget = path.join(ROOT, 'widget', 'dist', 'widget.js');
if (!fs.existsSync(widget)) { console.error('Build the widget first: node widget/build.mjs'); process.exit(1); }
const here = `http://127.0.0.1:${port}`;

// what Tag Manager does with the Custom HTML tag: a script element added after the page has loaded
const tag = `<script>(function(){var s=document.createElement('script');s.src='${here}/w/widget.js';s.async=true;
s.setAttribute('data-tajribah-store','${store}');s.setAttribute('data-tajribah-auto','salla');
s.setAttribute('data-tajribah-config','${here}/v1');s.setAttribute('data-tajribah-events','${here}/e');
s.setAttribute('data-tajribah-tryon','${dashboard}/embed/try-on');${spot === 'options' ? "s.setAttribute('data-tajribah-spot','options');" : ''}document.body.appendChild(s);})();</script>`;

/**
 * Where the store's own scripts may load from and talk to: the platform's file hosts and storefront API
 * (Salla's), this computer, and nothing else — so no visit is counted anywhere from here.
 */
const PLATFORM_FILES = 'https://cdn.salla.network https://cdn.assets.salla.network https://cdn.salla.sa';
const PLATFORM_API = 'https://api.salla.dev';
/** The payment providers whose boxes Salla shows on a product page (instalments, Apple Pay): part of the page's look. */
const PAYMENTS = 'https://*.tamara.co https://*.tabby.ai https://*.mispay.co https://applepay.cdn-apple.com';
const LOCAL = `http://127.0.0.1:* ${dashboard}`;
const csp = [
  `default-src 'self' ${from} ${PLATFORM_FILES} data: blob:`,
  `script-src 'self' 'unsafe-inline' 'unsafe-eval' ${PLATFORM_FILES} ${PAYMENTS} ${LOCAL}`,
  `connect-src 'self' ${PLATFORM_FILES} ${PLATFORM_API} ${PAYMENTS} ${LOCAL}`,
  // pictures from the store and the platform only: an outside pixel is not loaded either
  `img-src 'self' data: blob: ${from} https://*.salla.sa https://*.salla.network ${PAYMENTS} ${LOCAL}`,
  `style-src * 'unsafe-inline'`,
  `font-src * data:`,
  `frame-src ${PAYMENTS} ${LOCAL}`,
].join('; ');

/** A product page of the store, served from here: its own look, the tag added, nothing measured. */
function served(html) {
  const head = `<base href="${from}/"><meta http-equiv="Content-Security-Policy" content="${csp}">`
    + '<script>window.__cfRLUnblockHandlers = true;</script>'; // Rocket Loader's guard on inline handlers
  if (still) {
    return html.replace(/<script\b[\s\S]*?<\/script>/gi, '') // a still copy: no script of the store runs here
      .replace(/<head([^>]*)>/i, `<head$1><base href="${from}/">`)
      .replace(/<\/body>/i, `${tag}</body>`);
  }
  return html
    // Cloudflare's Rocket Loader holds the scripts back (type "<id>-text/javascript") and runs them itself: undone
    .replace(/<script\b[^>]*rocket-loader[^>]*><\/script>/gi, '')
    .replace(/type="[0-9a-f]{16,}-text\/javascript"/gi, 'type="text/javascript"')
    .replace(/type="[0-9a-f]{16,}-module"/gi, 'type="module"')
    .replace(/<head([^>]*)>/i, `<head$1>${head}`)
    .replace(/<\/body>/i, `${tag}</body>`);
}

const pages = new Map();
async function page(pathname) {
  if (!pages.has(pathname)) {
    const response = await fetch(from + pathname, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36', accept: 'text/html' } });
    if (!response.ok) return null;
    pages.set(pathname, served(await response.text()));
  }
  return pages.get(pathname);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', here);
  try {
    if (url.pathname === '/w/widget.js') { res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(fs.readFileSync(widget)); return; }
    if (url.pathname.startsWith('/v1/')) {
      const r = await fetch(dashboard + url.pathname);
      const body = r.ok ? (await r.text()).split('http://127.0.0.1:').join('https://127.0.0.1:') : '';
      res.writeHead(r.status, { 'content-type': 'application/json', 'access-control-allow-origin': '*' }); res.end(body); return;
    }
    if (url.pathname === '/e') { res.writeHead(204, { 'access-control-allow-origin': '*' }); res.end(); return; }
    const html = await page(url.pathname);
    res.writeHead(html ? 200 : 404, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html ?? `${from}${url.pathname} did not answer`);
  } catch (error) {
    res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); res.end(String(error));
  }
});
// one test shop at a time per port: say so plainly instead of a stack trace
server.on('error', (error) => {
  if (error.code !== 'EADDRINUSE') throw error;
  console.error(`Port ${port} is already in use — a test shop is probably running already: open ${here}/ar/x/p<product number>.`);
  console.error(`To run another one alongside it, add --port ${port + 1}.`);
  process.exit(1);
});
server.listen(port, '127.0.0.1', () => console.log(`test shop: ${here}/<a product page's path on ${from}> — with the tag for "${store}"`));
