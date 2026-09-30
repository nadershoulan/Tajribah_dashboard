#!/usr/bin/env node
/**
 * T57 — build and run the Node worker (`server/worker/node.ts`): the model optimisation and try-on
 * picture jobs, which need `sharp` and so cannot run on Cloudflare. Packages stay external (sharp's
 * native binary is loaded from node_modules); the bundle only resolves our own `@/` imports.
 *
 *   node scripts/worker-node.mjs [--build-only]
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(ROOT, 'node_modules', '_.js'));
const esbuild = require('esbuild');
const out = path.join(ROOT, 'dist-worker', 'node.mjs');
await esbuild.build({
  entryPoints: [path.join(ROOT, 'server/worker/node.ts')], outfile: out, bundle: true, platform: 'node', format: 'esm',
  target: 'node22', packages: 'external', tsconfig: path.join(ROOT, 'tsconfig.json'), logLevel: 'warning',
});
console.log(`built ${path.relative(ROOT, out)}`);
if (!process.argv.includes('--build-only')) await import(pathToFileURL(out).href);
