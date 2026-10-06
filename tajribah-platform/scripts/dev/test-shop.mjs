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
s.setAttribute('data-tajribah-tryon','${dashboard}/embed/try-on');document.body.appendChild(s);})();</script>`;

const pages = new Map();
async function page(pathname) {
  if (!pages.has(pathname)) {
    const response = await fetch(from + pathname, { headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36', accept: 'text/html' } });
    if (!response.ok) return null;
    pages.set(pathname, (await response.text())
      .replace(/<script\b[\s\S]*?<\/script>/gi, '') // a still copy: the store's own scripts do not run here
      .replace(/<head([^>]*)>/i, `<head$1><base href="${from}/">`) // its pictures and styles from the store
      .replace(/<\/body>/i, `${tag}</body>`));
  }
  return pages.get(pathname);
}

http.createServer(async (req, res) => {
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
}).listen(port, '127.0.0.1', () => console.log(`test shop: ${here}/<a product page's path on ${from}> — with the tag for "${store}"`));
