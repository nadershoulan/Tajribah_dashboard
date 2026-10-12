#!/usr/bin/env node
/**
 * T138 — the detection bench. Runs the site's own hand and face detection (`site/lib/hand-detect.ts`,
 * `face-detect.ts`, with the real MediaPipe models from `public/`) in a headless Chrome on real photos made harder the
 * way a shopper's photo goes wrong, and prints, per change: how often the hand or face is found, how often the product
 * then lands well (within a third of its width, 15°, and 20 % of its size of where the clean photo puts it), the median
 * miss and the time. Ground truth: the clean photo's detection, carried through each known change.
 *
 *   node scripts/dev/detection-bench/run.mjs [--out .tests-bench/run.json]
 *
 * Needs Chrome (CHROME=<path> to point at it). Nothing leaves the machine.
 */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../../..');
const work = path.join(root, '.tests-bench');
const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback; };
const out = path.resolve(root, arg('--out', '.tests-bench/run.json'));
const chromePath = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PHOTOS = [
  { file: 'model-wrist.webp', kind: 'hand' }, { file: 'model-hand.webp', kind: 'hand' }, { file: 'cam-wrist.jpg', kind: 'hand' },
  { file: 'cam-hand.jpg', kind: 'hand' }, { file: 'cam-hand2.jpg', kind: 'hand' }, { file: 'model-lifestyle.webp', kind: 'hand' },
  { file: 'model-bag.webp', kind: 'hand' },
  { file: 'model-face.webp', kind: 'face' }, { file: 'cam-face.jpg', kind: 'face' }, { file: 'cam-face2.jpg', kind: 'face' },
];

fs.mkdirSync(work, { recursive: true });
await build({ entryPoints: [path.join(here, 'bench.ts')], bundle: true, format: 'iife', outfile: path.join(work, 'bench.js'), logLevel: 'error', target: 'es2022' });

// the page, its script, the models and the photos — from the repository itself
const TYPES = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.task': 'application/octet-stream', '.webp': 'image/webp', '.jpg': 'image/jpeg', '.png': 'image/png' };
const fileFor = (url) => {
  const p = decodeURIComponent(new URL(url, 'http://x').pathname);
  if (p === '/bench.js') return path.join(work, 'bench.js');
  if (p.startsWith('/wasm/')) return path.join(root, 'public', p);
  if (p.startsWith('/assets/')) return path.join(root, 'public', p);
  if (p.startsWith('/photos/')) { const name = path.basename(p); const own = path.join(here, 'photos', name); return fs.existsSync(own) ? own : path.join(root, 'public/assets', name); }
  return null;
};
const server = http.createServer((req, res) => {
  if (req.url === '/' || req.url === '/bench.html') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end('<!doctype html><meta charset=utf-8><script src="/bench.js"></script>'); }
  const f = fileFor(req.url);
  if (!f || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const site = `http://127.0.0.1:${server.address().port}`;

// a headless Chrome, driven over its debugging protocol
const port = 9600 + Math.floor(Math.random() * 300);
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${path.join(work, 'chrome')}`, '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let rows;
try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json(); } catch { await new Promise((r) => setTimeout(r, 250)); } }
  if (!target?.webSocketDebuggerUrl) throw new Error(`Chrome did not start (${chromePath}) — set CHROME=<path>`);
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r, { once: true }));
  let id = 0; const pending = new Map();
  ws.addEventListener('message', (e) => { const m = JSON.parse(e.data); if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); } });
  const send = (method, params = {}) => new Promise((r) => { const n = ++id; pending.set(n, r); ws.send(JSON.stringify({ id: n, method, params })); });
  await send('Page.enable');
  await send('Page.navigate', { url: `${site}/bench.html` });
  await new Promise((r) => setTimeout(r, 2000));
  const r = await send('Runtime.evaluate', { expression: `bench(${JSON.stringify(PHOTOS)})`, awaitPromise: true, returnByValue: true, timeout: 1_800_000 });
  rows = r.result?.result?.value;
  if (!rows) throw new Error(`the bench failed: ${JSON.stringify(r.result).slice(0, 600)}`);
  ws.close();
} finally {
  chrome.kill();
  server.close();
}
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(rows, null, 1));

const good = (e) => e && e.pos < 0.35 && e.ang < 15 && e.size > 0.8 && e.size < 1.25;
const med = (xs) => { const s = xs.filter((x) => x != null).sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : null; };
const by = new Map();
for (const row of rows) { if (row.variant === '(truth)' || row.skipped) continue; if (!by.has(row.variant)) by.set(row.variant, []); by.get(row.variant).push(row); }
console.log('change'.padEnd(46), 'found'.padEnd(6), 'placed well'.padEnd(12), 'median miss', 'ms');
let found = 0, placed = 0, all = 0;
for (const [name, rs] of by) {
  const f = rs.filter((x) => x.found).length, p = rs.filter((x) => good(x.watch ?? x.glasses)).length;
  found += f; placed += p; all += rs.length;
  const miss = med(rs.map((x) => (x.watch ?? x.glasses)?.pos));
  console.log(name.padEnd(46), `${f}/${rs.length}`.padEnd(6), `${p}/${rs.length}`.padEnd(12), (miss == null ? '-' : miss.toFixed(2)).padEnd(11), med(rs.map((x) => x.ms)));
}
console.log(`\nTOTAL  found ${found}/${all}  placed well ${placed}/${all}   (rows: ${path.relative(root, out)})`);
