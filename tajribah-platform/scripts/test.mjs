/**
 * Test runner.
 *
 * This machine has Node 20 and no pnpm, so the project's own dependencies are not
 * installed (see CLAUDE.md). Tests are bundled with esbuild against an external toolkit
 * and run on `node:test`, which Node 20 has built in.
 *
 *   node scripts/test.mjs --modules <dir> [name-filter]
 *
 * `--modules` points at a node_modules directory containing esbuild, drizzle-orm and
 * @electric-sql/pglite. The bundles are written inside that directory so the driver resolves
 * normally — PGlite is left external because it loads its own WASM at runtime.
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const args = process.argv.slice(2);
const modulesFlag = args.indexOf('--modules');
const MODULES = modulesFlag === -1
  ? join(ROOT, 'node_modules')
  : resolve(args[modulesFlag + 1]);
const filter = args.filter((a, i) => !a.startsWith('--') && i !== modulesFlag + 1)[0] ?? '';

if (!existsSync(MODULES)) {
  console.error(`No node_modules at ${MODULES}. Pass --modules <dir>.`);
  process.exit(1);
}

const require = createRequire(join(MODULES, '_.js'));
const esbuild = require('esbuild');

/** Every *.test.ts under the source folders. */
function findTests(dir, found = []) {
  if (!existsSync(dir)) return found;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findTests(full, found);
    else if (entry.endsWith('.test.ts')) found.push(full);
  }
  return found;
}

/** Every bundled *.test.cjs under `dir`. */
function findBundles(dir, found = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) findBundles(full, found);
    else if (entry.endsWith('.test.cjs')) found.push(full);
  }
  return found.sort();
}

const tests = ['server', 'lib', 'db', 'widget']
  .flatMap((d) => findTests(join(ROOT, d)))
  .filter((f) => !filter || f.includes(filter));

if (tests.length === 0) {
  console.error(filter ? `No test files match "${filter}".` : 'No test files found.');
  process.exit(1);
}

const OUT = join(MODULES, '..', '.tests');
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

/** `@/x` resolves from the project root, the same as the tsconfig path alias. */
const aliasPlugin = {
  name: 'alias-at',
  setup(build) {
    build.onResolve({ filter: /^@\// }, (args) =>
      build.resolve('./' + args.path.slice(2), { kind: args.kind, resolveDir: ROOT }));
  },
};

/**
 * `sharp` is a native addon (reached through gltf-transform → ndarray-pixels, P1.13) and
 * cannot be bundled. Left external as a bare name it would be looked up from `.tests/`, where
 * pnpm's strict layout does not expose it — so it is pinned to the path its importer sees.
 */
const nativeAddonPlugin = {
  name: 'native-addons',
  setup(build) {
    build.onResolve({ filter: /^sharp$/ }, async (args) => {
      if (args.pluginData?.native) return undefined;
      const found = await build.resolve(args.path, { kind: 'require-call', resolveDir: args.resolveDir, pluginData: { native: true } });
      return { path: found.path, external: true };
    });
  },
};

await esbuild.build({
  entryPoints: tests,
  outdir: OUT,
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  sourcemap: 'inline',
  external: ['@electric-sql/pglite', 'node:*'], // PGlite loads its own WASM at runtime
  // The project has no node_modules of its own here; resolve packages from the toolkit.
  nodePaths: [MODULES],
  plugins: [aliasPlugin, nativeAddonPlugin],
  logLevel: 'warning',
});

console.log(`${tests.length} test file(s) bundled:`);
for (const t of tests) console.log('  ' + relative(ROOT, t));
console.log();

// The bundles by name, not the folder: Node 22 reads `--test` arguments as file patterns and
// no longer expands a directory, while Node 20 accepted either.
const bundles = findBundles(OUT);
const run = spawnSync(process.execPath, ['--test', ...bundles], { cwd: ROOT, stdio: 'inherit' });
process.exit(run.status ?? 1);
