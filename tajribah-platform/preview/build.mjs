/**
 * Builds the static preview of the Tajribah dashboard into dist-preview/.
 *
 *   node preview/build.mjs [--modules <node_modules dir>] [--out <dir>]
 *
 * The preview renders the real page components against the seeded demo source, so it shows
 * what the dashboard is, not a picture of it. `--modules` points at a node_modules holding
 * react, react-dom, lucide-react, esbuild, tailwindcss, @tailwindcss/cli and tw-animate-css;
 * it defaults to this project's own, so a normal install needs no flag.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? path.resolve(process.argv[i + 1]) : fallback;
};
const modules = arg('--modules', path.join(root, 'node_modules'));
const out = arg('--out', path.join(root, 'dist-preview'));
const req = createRequire(path.join(modules, 'noop.js'));
const posix = (p) => p.split(path.sep).join('/');

// Windows occasionally holds a handle on a file another process just read (a browser
// that screenshotted the last build, say), so removing the directory can fail once.
for (let attempt = 0; ; attempt++) {
  try { fs.rmSync(out, { recursive: true, force: true, maxRetries: 5, retryDelay: 120 }); break; }
  catch (error) {
    if (attempt >= 3) throw error;
  }
}
fs.mkdirSync(out, { recursive: true });

// 1. JavaScript — one self-contained bundle, no module loader needed.
const esbuild = req('esbuild');
await esbuild.build({
  entryPoints: [path.join(root, 'preview', 'main.tsx')],
  outfile: path.join(out, 'app.js'),
  bundle: true,
  format: 'iife',
  platform: 'browser',
  target: ['es2020'],
  minify: true,
  jsx: 'automatic',
  tsconfig: path.join(root, 'tsconfig.json'),
  nodePaths: [modules],
  define: { 'process.env.NODE_ENV': '"production"' },
  logLevel: 'warning',
  logOverride: { 'module-level-directive': 'silent' },
});

// 2. CSS — the app's own theme and dashboard styles, compiled with Tailwind v4.
//    The entry sits beside `modules` so bare package imports resolve there.
const entryDir = path.dirname(modules);
const entry = path.join(entryDir, '.tajribah-platform.css');
const rel = (p) => posix(path.relative(entryDir, p));
fs.writeFileSync(entry, [
  '@import "tailwindcss" source(none);',
  ...['components', 'app', 'lib', 'preview'].map((d) => `@source "${rel(path.join(root, d))}";`),
  '@import "tw-animate-css";',
  `@import "${rel(path.join(root, 'vendor', 'shadcn-tailwind-4.13.0.css'))}";`,
  `@import "${rel(path.join(root, 'app', 'theme.css'))}";`,
  `@import "${rel(path.join(root, 'app', 'dashboard.css'))}";`,
].join('\n'));
// @tailwindcss/cli exposes only a binary, so locate it through its package.json.
const cliPkg = path.join(modules, '@tailwindcss', 'cli', 'package.json');
const cliBin = JSON.parse(fs.readFileSync(cliPkg, 'utf8')).bin;
const cli = path.join(path.dirname(cliPkg), typeof cliBin === 'string' ? cliBin : Object.values(cliBin)[0]);
const tw = spawnSync(process.execPath, [cli, '-i', entry, '-o', path.join(out, 'app.css'), '--minify'],
  { cwd: entryDir, stdio: 'inherit' });
fs.rmSync(entry, { force: true });
if (tw.status !== 0) process.exit(tw.status ?? 1);

// 3. Public files the pages reference.
const copy = (from, to = from) => {
  const src = path.join(root, 'public', from);
  if (!fs.existsSync(src)) return;
  const dst = path.join(out, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
};
copy('brand');

// 4. The page. Written body-first: hosts that wrap pages in their own document skeleton
//    take it as is; `preview.html` is a full document for opening locally.
const body = `<title>تجربة Tajribah — لوحة التحكم</title>
<meta name="description" content="لوحة تحكم تجربة: المنتجات والنماذج ثلاثية الأبعاد والتحليلات والاشتراك لمتاجر السعودية.">
<link rel="icon" href="brand/favicon-32.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Readex+Pro:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="app.css">
<div id="root"></div>
<script src="app.js"></script>
`;
fs.writeFileSync(path.join(out, 'index.html'), body);
fs.writeFileSync(path.join(out, 'preview.html'),
  `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n${body}</body></html>\n`);

const size = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + ' KB';
console.log(`preview built -> ${out}\n  app.js ${size('app.js')}  app.css ${size('app.css')}`);
