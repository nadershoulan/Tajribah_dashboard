/**
 * Writes `.env.example` from the env registry (server/core/config/env.ts).
 *
 *   node scripts/gen-env-example.mjs --modules <dir>           write the file
 *   node scripts/gen-env-example.mjs --modules <dir> --check   exit 1 if it is out of date
 *
 * `--modules` points at a node_modules with esbuild and zod (see scripts/test.mjs).
 */
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
};
const MODULES = path.resolve(arg('--modules', path.join(ROOT, 'node_modules')));
const OUT = path.join(ROOT, '.env.example');
const check = process.argv.includes('--check');

const require = createRequire(path.join(MODULES, '_.js'));
const esbuild = require('esbuild');

const source = path.join(ROOT, 'server/core/config/env-example.ts').split(path.sep).join('/');
const entry = path.join(MODULES, '..', '.env-entry.mjs');
const bundle = path.join(MODULES, '..', '.env-bundle.cjs');
fs.writeFileSync(entry, `import { renderEnvExample } from '${source}';\nprocess.stdout.write(renderEnvExample());\n`);
await esbuild.build({
  entryPoints: [entry], outfile: bundle, bundle: true, platform: 'node', format: 'cjs',
  target: 'node20', nodePaths: [MODULES], logLevel: 'warning',
});
const rendered = execFileSync(process.execPath, [bundle], { encoding: 'utf8' });
fs.rmSync(entry, { force: true });
fs.rmSync(bundle, { force: true });

if (check) {
  const current = fs.existsSync(OUT) ? fs.readFileSync(OUT, 'utf8') : '';
  if (current !== rendered) {
    console.error('.env.example is out of date with server/core/config/env.ts — run node scripts/gen-env-example.mjs');
    process.exit(1);
  }
  console.log('.env.example is up to date');
} else {
  fs.writeFileSync(OUT, rendered);
  console.log(`wrote .env.example — ${rendered.split('\n').filter((l) => /^[A-Z_]+=/.test(l)).length} variables`);
}
