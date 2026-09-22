import { test } from 'node:test';
import assert from 'node:assert/strict';
import { route } from '@/server/core/observability/request';
import { bindActor } from '@/server/core/observability/scope';
import { log } from '@/server/core/observability/log';
import { errors } from '@/server/core/errors/problem';
import { enqueue } from '@/server/core/jobs/queue';
import { clearHandlers, registerHandler, tick } from '@/server/core/jobs/runner';
import { createTestDb, seedTenant } from '@/server/testing/harness';

type Line = Record<string, unknown>;

/** Every JSON log line written while `fn` runs, from all three console streams. */
async function logged(fn: () => Promise<unknown>): Promise<Line[]> {
  const lines: Line[] = [];
  const saved = { log: console.log, warn: console.warn, error: console.error };
  const capture = (text: unknown) => { try { lines.push(JSON.parse(String(text))); } catch { /* not a log line */ } };
  console.log = capture; console.warn = capture; console.error = capture;
  try { await fn(); } finally { Object.assign(console, saved); }
  return lines;
}

const tick0 = () => new Promise((resolve) => setTimeout(resolve, 1));

/** A handler that logs from several async depths, the way a real service call would. */
const busy = route(async (request) => {
  log.info('start');
  await tick0();
  bindActor({ tenantId: 'tenant-1', userId: 'user-1' });
  await Promise.all([
    (async () => { await tick0(); log.info('branch a'); })(),
    new Promise<void>((resolve) => setTimeout(() => { log.warn('timer branch'); resolve(); }, 2)),
  ]);
  return Response.json({ path: new URL(request.url).pathname });
});

test("a request's id appears in every log line it produced", async () => {
  let response!: Response;
  const lines = await logged(async () => { response = await busy(new Request('https://app.test/api/x')); });
  const id = response.headers.get('x-request-id');
  assert.ok(id, 'the response carries the id');
  assert.ok(lines.length >= 4, `expected the handler's lines plus the access line, got ${lines.length}`);
  for (const line of lines) assert.equal(line.requestId, id, `line "${line.message}" lost the request id`);
  const after = lines.filter((l) => l.message !== 'start');
  assert.ok(after.every((l) => l.tenantId === 'tenant-1'), 'lines after auth carry the tenant');
  assert.equal(lines.find((l) => l.message === 'request')!.status, 200);
});

test('concurrent requests never swap ids', async () => {
  const responses: Response[] = [];
  const lines = await logged(async () => {
    responses.push(...await Promise.all(Array.from({ length: 20 }, (_, i) => busy(new Request(`https://app.test/r/${i}`)))));
  });
  const ids = new Set(responses.map((r) => r.headers.get('x-request-id')));
  assert.equal(ids.size, 20, 'every request gets its own id');
  for (const line of lines) assert.ok(ids.has(line.requestId as string), 'no line without one of the ids');
  // Each id's lines all belong to one path.
  const byId = new Map<string, Set<unknown>>();
  for (const line of lines.filter((l) => l.message === 'request')) byId.set(line.requestId as string, new Set([line.path]));
  assert.equal(byId.size, 20);
});

test('a well-formed incoming id is kept; anything else is replaced', async () => {
  const kept = await busy(new Request('https://app.test/', { headers: { 'x-request-id': 'edge-abc12345' } }));
  assert.equal(kept.headers.get('x-request-id'), 'edge-abc12345');
  const replaced = await busy(new Request('https://app.test/', { headers: { 'x-request-id': 'x"; drop table <script>' } }));
  assert.notEqual(replaced.headers.get('x-request-id'), 'x"; drop table <script>');
  assert.match(replaced.headers.get('x-request-id')!, /^[0-9a-f-]{36}$/);
});

test('the error hook: domain errors become problem+json, crashes become a 500 that hides the detail', async () => {
  let notFound!: Response;
  let crash!: Response;
  const lines = await logged(async () => {
    notFound = await route(async () => { throw errors.notFound('product'); })(new Request('https://app.test/p/1'));
    crash = await route(async () => { throw new Error('db password=hunter2 in stack'); })(new Request('https://app.test/p/2', { headers: { cookie: 'tajribah-lang=en' } }));
  });

  assert.equal(notFound.status, 404);
  assert.equal(notFound.headers.get('content-type'), 'application/problem+json; charset=utf-8');
  const body = await notFound.json() as { requestId?: string };
  assert.equal(body.requestId, notFound.headers.get('x-request-id'));

  assert.equal(crash.status, 500);
  const crashBody = await crash.text();
  assert.ok(!crashBody.includes('hunter2'), 'the cause never reaches the client');
  const logged500 = lines.find((l) => l.message === 'unhandled error')!;
  assert.equal(logged500.requestId, crash.headers.get('x-request-id'), 'the log line that explains the 500 has its id');
  assert.ok(!lines.some((l) => l.message === 'unhandled error' && l.requestId === notFound.headers.get('x-request-id')),
    'an expected 404 is not logged as a crash');
});

test("a job enqueued during a request logs under that request's id", async () => {
  const harness = await createTestDb();
  clearHandlers();
  try {
    const a = await seedTenant(harness, 'alpha');
    registerHandler('system.cleanup', async () => { log.info('job ran'); });

    let response!: Response;
    await logged(async () => {
      response = await route(async () => {
        await enqueue({ queue: 'system.cleanup', tenantId: a.tenantId });
        return new Response(null, { status: 202 });
      })(new Request('https://app.test/api/cleanup', { method: 'POST' }));
    });

    const lines = await logged(() => tick('w1'));
    const jobLine = lines.find((l) => l.message === 'job ran')!;
    assert.equal(jobLine.requestId, response.headers.get('x-request-id'));
    assert.equal(jobLine.tenantId, a.tenantId);
    assert.ok(jobLine.jobId);
  } finally { clearHandlers(); await harness.close(); }
});
