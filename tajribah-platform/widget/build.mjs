/**
 * P1.16 — build the storefront widget: one self-contained, minified IIFE with no imports.
 *
 *   node widget/build.mjs --modules node_modules   → widget/dist/widget.js (+ its gzip size)
 *
 * `buildWidget()` is also what the budget test calls, so the test measures the real artifact.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const here = path.dirname(fileURLToPath(import.meta.url));
export const BUDGET_GZIP_BYTES = 60 * 1024;

export async function buildWidget(modules = path.join(here, '..', 'node_modules')) {
  const esbuild = createRequire(path.join(modules, '_.js'))('esbuild');
  const result = await esbuild.build({
    entryPoints: [path.join(here, 'src', 'index.ts')],
    bundle: true, minify: true, format: 'iife', target: ['es2020'], // iOS 15+: esbuild will not lower destructuring around Safari 14's bug
    write: false, legalComments: 'none', logLevel: 'silent',
  });
  const code = result.outputFiles[0].contents;
  return { code, bytes: code.byteLength, gzipBytes: gzipSync(code, { level: 9 }).byteLength };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const i = process.argv.indexOf('--modules');
  const { code, bytes, gzipBytes } = await buildWidget(i > -1 ? path.resolve(process.argv[i + 1]) : undefined);
  fs.mkdirSync(path.join(here, 'dist', 'vendor'), { recursive: true });
  fs.writeFileSync(path.join(here, 'dist', 'widget.js'), code);
  // P3.5: the meshopt decoder `<model-viewer>` loads for our compressed models, deployed next to
  // the viewer. The file name carries the version the optimiser encodes with; refuse a mismatch.
  const modules = i > -1 ? path.resolve(process.argv[i + 1]) : path.join(here, '..', 'node_modules');
  const meshopt = JSON.parse(fs.readFileSync(path.join(modules, 'meshoptimizer', 'package.json'), 'utf8')).version;
  const decoder = `meshopt_decoder-${meshopt}.js`;
  if (!new TextDecoder().decode(code).includes(decoder)) {
    console.error(`the widget asks for a different decoder than ${decoder} — update MESHOPT_DECODER_FILE in widget/src/main.ts`);
    process.exit(1);
  }
  fs.copyFileSync(path.join(modules, 'meshoptimizer', 'meshopt_decoder.cjs'), path.join(here, 'dist', 'vendor', decoder));
  console.log(`widget/dist/widget.js  ${(bytes / 1024).toFixed(1)} KB, ${(gzipBytes / 1024).toFixed(1)} KB gzipped (budget ${BUDGET_GZIP_BYTES / 1024} KB)`);
  if (gzipBytes >= BUDGET_GZIP_BYTES) process.exit(1);
}
