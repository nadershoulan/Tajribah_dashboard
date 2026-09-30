/**
 * P7 — the Cloudflare Worker must not load `sharp`. It is a native Node module: one import anywhere
 * under `server/worker/entry.ts` and the Worker fails at start-up — every page, not just the job
 * (seen in workerd on 2026-09-30, before the handlers were split). This walks the entry's imports,
 * file by file, and fails on any path to `sharp`, naming the chain.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const ROOT = process.cwd();
const NATIVE = ['sharp'];

function resolveImport(from: string, spec: string): string | null {
  const base = spec.startsWith('@/') ? join(ROOT, spec.slice(2)) : spec.startsWith('.') ? resolve(dirname(from), spec) : null;
  if (!base) return null;
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts')]) {
    if (existsSync(candidate) && candidate.match(/\.tsx?$/)) return candidate;
  }
  return null;
}

/** Every package a file's graph reaches, with the chain that reached it. */
function walk(entry: string): Map<string, string[]> {
  const packages = new Map<string, string[]>();
  const seen = new Set<string>();
  const queue: { file: string; chain: string[] }[] = [{ file: entry, chain: [relative(ROOT, entry)] }];
  while (queue.length) {
    const { file, chain } = queue.shift()!;
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    // Static imports and re-exports; `import type` is erased and loads nothing.
    for (const match of source.matchAll(/^\s*(?:import|export)\s+(?!type\s)(?:[^'"]*?\sfrom\s+)?['"]([^'"]+)['"]/gm)) {
      const spec = match[1]!;
      const next = resolveImport(file, spec);
      if (next) queue.push({ file: next, chain: [...chain, relative(ROOT, next)] });
      else if (!spec.startsWith('.') && !spec.startsWith('@/') && !packages.has(spec)) packages.set(spec, chain);
    }
  }
  return packages;
}

test('nothing the Cloudflare Worker loads imports sharp', () => {
  const reached = walk(join(ROOT, 'server/worker/entry.ts'));
  assert.ok(reached.has('vinext/server/fetch-handler'), 'the walk follows the entry');
  for (const name of NATIVE) {
    assert.equal(reached.get(name), undefined, `${name} reached through: ${reached.get(name)?.join(' → ')}`);
  }
});

test('the check sees sharp where it is: the Node worker', () => {
  const reached = walk(join(ROOT, 'server/worker/main.ts'));
  assert.ok(reached.has('sharp'), 'main.ts registers the image handlers, so sharp is in its graph');
});

test('the Worker runs every queue but the two that need Node, and says which it runs', async () => {
  const { clearHandlers, registeredQueues } = await import('@/server/core/jobs/runner');
  const { NODE_ONLY_QUEUES, registerEdgeHandlers } = await import('@/server/worker/handlers-edge');
  const { registerAllHandlers } = await import('@/server/worker/handlers');
  const { runQueuePass } = await import('@/server/worker/passes');

  // No runtime chose its handlers: a pass refuses loudly rather than claiming nothing forever.
  await assert.rejects(() => runQueuePass(), /no job handlers chosen/);
  assert.match(readFileSync(join(ROOT, 'server/worker/entry.ts'), 'utf8'), /^chooseHandlers\(registerEdgeHandlers\);$/m, 'the entry chooses the Workers-safe handlers');

  clearHandlers();
  registerAllHandlers();
  const all = registeredQueues();
  clearHandlers();
  registerEdgeHandlers();
  const edge = registeredQueues();
  clearHandlers();
  assert.deepEqual([...NODE_ONLY_QUEUES].sort(), ['ai.postprocess', 'tryon.quality']);
  assert.deepEqual(all.filter((q) => !edge.includes(q)).sort(), [...NODE_ONLY_QUEUES].sort(), 'the Node worker adds exactly these');
  assert.ok(edge.includes('sync.products') && edge.includes('edge.publish-config') && edge.includes('webhooks.deliver'));
});

test('no API route loads sharp either — every request runs on Workers (found on the real stack, 2026-09-30)', () => {
  const api = join(ROOT, 'app', 'api');
  const routeFiles: string[] = [];
  const collect = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) collect(path); else if (name === 'route.ts') routeFiles.push(path);
    }
  };
  collect(api);
  assert.ok(routeFiles.length > 60, `found the routes (${routeFiles.length})`);
  const offenders = routeFiles.map((file) => [relative(ROOT, file), walk(file).get('sharp')] as const).filter(([, chain]) => chain);
  assert.deepEqual(offenders.map(([file, chain]) => `${file}: ${chain!.join(' → ')}`), []);
});
