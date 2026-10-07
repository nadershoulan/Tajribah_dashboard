/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * P0.20 — on Workers, database connections belong to one unit of work: opened on its first query,
 * shared by everything inside it (nested units included), ended when it settles — whether it
 * answered or threw — and never used by another. A query outside any unit is refused loudly.
 * Boot registers the connector from the environment, and production will not start without one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clearDb, isDbRegistered, pingDb, registerDbConnector, unsafeAdminDb, appDb, withDbConnection, type Db } from '@/db/client';
import { resetEnv } from '@/server/core/config/env';
import { bootstrap } from '@/server/core/http/bootstrap';
import { route } from '@/server/core/observability/request';

function fakeConnector() {
  const opened: { id: number; ended: boolean }[] = [];
  const connect = () => {
    const record = { id: opened.length + 1, ended: false };
    opened.push(record);
    const handle = (role: string) => ({ role, id: record.id, execute: async () => ({ rows: [] }) }) as unknown as Db;
    return { app: handle('app'), admin: handle('admin'), end: async () => { record.ended = true; } };
  };
  return { opened, connect };
}

test('one unit of work, one connection per role — opened lazily, shared, ended at the end', async () => {
  clearDb();
  const world = fakeConnector();
  registerDbConnector(world.connect);
  try {
    assert.equal(isDbRegistered(), true);
    assert.throws(() => appDb(), /outside a unit of work/, 'a query with no unit of work is refused, not given a stray connection');

    await withDbConnection(async () => { /* no query: nothing opened */ });
    assert.equal(world.opened.length, 0, 'opened lazily');

    const seen = await withDbConnection(async () => {
      const first = [(appDb() as any).id, (unsafeAdminDb() as any).id];
      const inner = await withDbConnection(async () => (appDb() as any).id); // nested: the same one
      await Promise.all([1, 2, 3].map(async () => (unsafeAdminDb() as any).id));
      return [...first, inner];
    });
    assert.deepEqual(seen, [1, 1, 1]);
    assert.deepEqual(world.opened, [{ id: 1, ended: true }], 'one, ended when the unit settled');

    await assert.rejects(() => withDbConnection(async () => { appDb(); throw new Error('handler failed'); }), /handler failed/);
    assert.deepEqual(world.opened.map((o) => o.ended), [true, true], 'ended after a failure too');

    // Two units at once (two requests): never the same connection.
    const ids = await Promise.all([1, 2].map(() => withDbConnection(async () => { await new Promise((r) => setTimeout(r, 5)); return (appDb() as any).id; })));
    assert.notEqual(ids[0], ids[1]);

    // Every route is a unit of work.
    const handler = route(async () => Response.json({ id: (appDb() as any).id }));
    const answered = await (await handler(new Request('http://x/api/x'))).json() as any;
    assert.equal(world.opened.find((o) => o.id === answered.id)?.ended, true);
    assert.equal(await withDbConnection(() => pingDb()), 'ok');
  } finally { clearDb(); }
});

test('boot: the database from the environment or Hyperdrive; production refuses to start without one', () => {
  const BASE = { APP_URL: 'http://localhost:5173', AUTH_SECRET: 'a'.repeat(40), ENCRYPTION_KEY: 'b'.repeat(40) };
  resetEnv(); clearDb();
  bootstrap(BASE);
  assert.equal(isDbRegistered(), false, 'none named: none registered (the first query says so)');

  resetEnv(); clearDb();
  bootstrap({ ...BASE, DATABASE_APP_URL: 'postgresql://app@db:5432/t', DATABASE_ADMIN_URL: 'postgresql://admin@db:5432/t' });
  assert.equal(isDbRegistered(), true);

  resetEnv(); clearDb();
  assert.throws(() => bootstrap({ ...BASE, DATABASE_APP_URL: 'postgresql://app@db:5432/t' }), /DATABASE_ADMIN_URL/, 'one login per role, both or neither');
  resetEnv(); clearDb();
  assert.throws(() => bootstrap({ ...BASE, DATABASE_APP_URL: 'mysql://x', DATABASE_ADMIN_URL: 'postgresql://a@b/c' }), /DATABASE_APP_URL/);

  resetEnv(); clearDb();
  bootstrap({ ...BASE, HYPERDRIVE_APP: { connectionString: 'postgresql://app@hd/t' }, HYPERDRIVE_ADMIN: { connectionString: 'postgresql://admin@hd/t' } });
  assert.equal(isDbRegistered(), true, 'Hyperdrive bindings');

  const PRODUCTION = { ...BASE, NODE_ENV: 'production', APP_URL: 'https://app.tajribah.sa', SMS_PROVIDER: 'unifonic', UNIFONIC_APP_SID: 'x', UNIFONIC_SENDER_ID: 'Tajribah',
    STORAGE_PROVIDER: 'r2', CDN_BASE_URL: 'https://cdn.tajribah.org', CONFIG_STORE: 'kv', RATE_LIMITER: 'kv', JOBS_MODE: 'cf-queue' };
  const BINDINGS = { BUCKET: {}, CONFIGS: {}, RATE_LIMITS: {}, JOBS: { send: async () => {} } };
  resetEnv(); clearDb();
  assert.throws(() => bootstrap({ ...PRODUCTION, ...BINDINGS }), /no database/);
  resetEnv(); clearDb();
  bootstrap({ ...PRODUCTION, ...BINDINGS, HYPERDRIVE_APP: { connectionString: 'postgresql://a@hd/t' }, HYPERDRIVE_ADMIN: { connectionString: 'postgresql://b@hd/t' } });
  resetEnv(); clearDb();
});
