/**
 * Builds the static preview of the Tajribah site into dist-preview/.
 *
 *   node preview/build.mjs [--modules <node_modules dir>] [--out <dir>]
 *
 * --modules points at a node_modules that has react, react-dom, radix-ui,
 * lucide-react, qrcode, @mediapipe/tasks-vision, clsx, tailwind-merge,
 * class-variance-authority, esbuild, tailwindcss, @tailwindcss/cli and
 * tw-animate-css. It defaults to this project's own node_modules, so after a
 * normal install (plus `esbuild` and `@tailwindcss/cli`) no flag is needed.
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

fs.rmSync(out, { recursive: true, force: true });
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

// 2. CSS — the app's own theme + site styles, compiled with Tailwind v4.
//    The entry sits beside `modules` so bare package imports resolve there.
const entryDir = path.dirname(modules);
const entry = path.join(entryDir, '.tajribah-preview.css');
const rel = (p) => posix(path.relative(entryDir, p));
fs.writeFileSync(entry, [
  '@import "tailwindcss" source(none);',
  ...['components', 'app', 'lib', 'content', 'preview'].map((d) => `@source "${rel(path.join(root, d))}";`),
  '@import "tw-animate-css";',
  `@import "${rel(path.join(root, 'vendor', 'shadcn-tailwind-4.13.0.css'))}";`,
  `@import "${rel(path.join(root, 'app', 'theme.css'))}";`,
  `@import "${rel(path.join(root, 'app', 'site.css'))}";`,
].join('\n'));
// @tailwindcss/cli (the scratch toolkit) exposes only a binary, so locate it through its
// package.json. A real project install has @tailwindcss/postcss instead — the same compiler
// behind the Next build — so fall back to that rather than install a second copy.
const cliPkg = path.join(modules, '@tailwindcss', 'cli', 'package.json');
if (fs.existsSync(cliPkg)) {
  const cliBin = JSON.parse(fs.readFileSync(cliPkg, 'utf8')).bin;
  const cli = path.join(path.dirname(cliPkg), typeof cliBin === 'string' ? cliBin : Object.values(cliBin)[0]);
  const tw = spawnSync(process.execPath, [cli, '-i', entry, '-o', path.join(out, 'site.css'), '--minify'], { cwd: entryDir, stdio: 'inherit' });
  fs.rmSync(entry, { force: true });
  if (tw.status !== 0) process.exit(tw.status ?? 1);
} else {
  const tailwind = req('@tailwindcss/postcss');
  // pnpm keeps postcss out of the top level; ask for it where @tailwindcss/postcss finds it.
  const postcss = createRequire(req.resolve('@tailwindcss/postcss'))('postcss');
  try {
    const result = await postcss([tailwind({ base: entryDir, optimize: { minify: true } })])
      .process(fs.readFileSync(entry, 'utf8'), { from: entry, to: path.join(out, 'site.css') });
    fs.writeFileSync(path.join(out, 'site.css'), result.css);
  } finally {
    fs.rmSync(entry, { force: true });
  }
}

// 3. Public files the pages use. Only the SIMD wasm build is shipped; every
//    browser that can run the studio supports it.
const copy = (from, to = from) => {
  const src = path.join(root, 'public', from), dst = path.join(out, to);
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.cpSync(src, dst, { recursive: true });
};
copy('brand');
for (const f of ['model-wrist.webp', 'model-wrist-thumb.webp', 'model-lifestyle.webp', 'model-lifestyle-thumb.webp',
  'watch-layer-0.png', 'watch-flat.png', 'iphone.png', 'airpods.webp', 'riyal.webp',
  'model-face.webp', 'model-face-thumb.webp', 'glasses-front.png',
  'model-hand.webp', 'model-hand-thumb.webp', 'ring-top.webp']) copy(`assets/${f}`);
copy('assets/hand-landmarker.task', 'assets/hand-landmarker.task.wasm'); // see RENAMED in main.tsx
copy('wasm/vision_wasm_internal.js');
copy('wasm/vision_wasm_internal.wasm');

// 4. The page. Written body-first: hosts that wrap pages in their own
//    document skeleton take it as is; `preview.html` is a full document for
//    opening locally.
const body = `<title>تجربة Tajribah</title>
<meta name="description" content="تجربة افتراضية ومقارنة بالحجم الحقيقي لمتاجر الساعات والمجوهرات والإكسسوارات في السعودية.">
<link rel="icon" href="brand/favicon-32.png" type="image/png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500;600&family=IBM+Plex+Sans+Arabic:wght@400;500;600&family=Readex+Pro:wght@400;500;600;700&display=swap">
<link rel="stylesheet" href="site.css">
<div id="root"></div>
<script src="app.js"></script>
`;
fs.writeFileSync(path.join(out, 'index.html'), body);
fs.writeFileSync(path.join(out, 'preview.html'),
  `<!doctype html><html lang="ar" dir="rtl"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"></head><body>\n${body}</body></html>\n`);

const size = (f) => (fs.statSync(path.join(out, f)).size / 1024).toFixed(0) + ' KB';
console.log(`preview built -> ${out}\n  app.js ${size('app.js')}  site.css ${size('site.css')}`);
