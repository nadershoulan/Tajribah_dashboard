/**
 * The test harness: a real PostgreSQL, in process, with the real migrations applied —
 * including the row-level security policies.
 *
 * §5 is explicit that RLS cannot be tested against a mock, and §13.2 adds the sharper
 * version: **a superuser ignores RLS entirely**, so a test that runs as one proves nothing.
 * PGlite is one connection that starts as `postgres`, so the harness registers two clients
 * over it, each of which switches to its role before every statement: `tajribah_app` for
 * `withTenant` and `harness.db`, `tajribah_admin` for `unsafeAdminDb()` — the same split as
 * production, where they are two pools.
 *
 * `asAdmin()` is the only way back to the superuser, and it exists so the isolation suite
 * can plant another tenant's row — which is precisely what a scoped connection must not be
 * able to do.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { eq, sql } from 'drizzle-orm';
import * as schema from '@/db/schema';
import { clearDb, registerDb, type Db } from '@/db/client';
import { uuidv7 } from '@/lib/ids';

const MIGRATIONS_DIR = join(process.cwd(), 'drizzle');
export const APP_ROLE = 'tajribah_app';
export const ADMIN_ROLE = 'tajribah_admin';

/** Every `.sql` migration, in filename order, split on Drizzle's statement breakpoints. */
export function migrationStatements(): string[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const statements: string[] = [];
  for (const file of files) {
    const text = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    // Everything after the rollback marker is commented-out reverse SQL; never applied.
    const forward = text.split('-- ROLLBACK:')[0];
    for (const part of forward.split('--> statement-breakpoint')) {
      const trimmed = part.trim();
      if (trimmed && !trimmed.split('\n').every((line) => line.trim().startsWith('--'))) {
        statements.push(trimmed);
      }
    }
  }
  return statements;
}

/**
 * `client`, with every statement run as `role` — or as the superuser while `asAdmin()` is on.
 * Drizzle's PGlite driver only calls `query` and `transaction`, so those are the two wrapped.
 */
/** Sees every statement the application sends, with its parameters (P7: the query-plan checks). */
export type QueryObserver = (text: string, params: unknown[]) => void;

function observed<T extends object>(target: T, observe: QueryObserver): T {
  return new Proxy(target, {
    get(t, prop) {
      const value = (t as any)[prop];
      if (prop === 'query') return (text: string, params: unknown[] = [], ...rest: unknown[]) => { observe(text, params); return value.call(t, text, params, ...rest); };
      return typeof value === 'function' ? value.bind(t) : value;
    },
  });
}

function asRole(client: PGlite, role: string, superuser: { on: boolean }, observe?: QueryObserver): PGlite {
  const roleSql = (local: boolean) => (superuser.on ? 'RESET ROLE;' : `SET ${local ? 'LOCAL ' : ''}ROLE ${role};`);
  return new Proxy(client, {
    get(target, prop) {
      if (prop === 'query') {
        return async (...args: Parameters<PGlite['query']>) => {
          await target.exec(roleSql(false));
          if (observe) observe(args[0], (args[1] as unknown[] | undefined) ?? []);
          return target.query(...args);
        };
      }
      if (prop === 'transaction') {
        return <T>(fn: (tx: any) => Promise<T>) => target.transaction(async (tx) => {
          await tx.exec(roleSql(true));
          return fn(observe ? observed(tx, observe) : tx);
        });
      }
      const value = (target as any)[prop];
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

/**
 * The `-- ROLLBACK:` block of each migration, uncommented, newest migration first — the
 * order a real rollback runs in. §7.11: a rollback nobody has run is a guess.
 */
export function rollbackStatements(): { file: string; statements: string[] }[] {
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort().reverse();
  return files.map((file) => {
    const text = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
    const block = text.split('-- ROLLBACK:')[1] ?? '';
    const statements = block.split('\n')
      .map((line) => line.replace(/^--\s?/, '').trim())
      // CREATE / INSERT / GRANT too: undoing a table rebuild (0002) has to build the old one back.
      // DELETE: undoing a seed (0006, the plan catalogue) removes its rows.
      // UPDATE: undoing a data change (0019, the Starter plan's Arabic name) sets it back.
      .filter((line) => /^(DROP|ALTER|REVOKE|CREATE|INSERT|GRANT|DELETE|UPDATE)\b/i.test(line));
    return { file, statements };
  });
}

export type TestDb = {
  /** The application role — RLS applies. */
  db: Db;
  /** Run `fn` as the superuser, bypassing RLS. Seeding another tenant's data, and nothing else. */
  asAdmin: <T>(fn: () => Promise<T>) => Promise<T>;
  /** The planner's JSON plan for `text` with `params`, as the superuser, with `settings` applied first. */
  explain: (text: string, params: unknown[], settings?: string) => Promise<any>;
  close: () => Promise<void>;
};

export async function createTestDb(options: { observe?: QueryObserver } = {}): Promise<TestDb> {
  const client = await PGlite.create();
  for (const statement of migrationStatements()) {
    try {
      await client.exec(statement);
    } catch (error) {
      throw new Error(`Migration statement failed:\n${statement.slice(0, 300)}\n\n${String(error)}`);
    }
  }

  // From here on no statement runs as the superuser unless `asAdmin()` says so: the app
  // client is neither owner nor superuser, so `FORCE ROW LEVEL SECURITY` actually bites.
  const superuser = { on: false };
  const db = drizzle(asRole(client, APP_ROLE, superuser, options.observe), { schema }) as unknown as Db;
  const admin = drizzle(asRole(client, ADMIN_ROLE, superuser, options.observe), { schema }) as unknown as Db;
  registerDb(db, admin);

  const asAdmin = async <T>(fn: () => Promise<T>): Promise<T> => {
    superuser.on = true;
    try {
      return await fn();
    } finally {
      superuser.on = false;
    }
  };

  const explain = async (text: string, params: unknown[], settings = '') => {
    await client.exec(`RESET ROLE; ${settings}`);
    const result = await client.query<Record<string, unknown>>(`EXPLAIN (FORMAT JSON) ${text}`, params)
      .finally(() => client.exec('RESET ALL;')); // the settings must not outlive the question
    const raw = result.rows[0]!['QUERY PLAN'];
    return (typeof raw === 'string' ? JSON.parse(raw) : raw as any[])[0].Plan;
  };

  return {
    db,
    asAdmin,
    explain,
    close: async () => { await client.close(); clearDb(); },
  };
}

/** Set the tenant for statements that follow, outside a transaction. Tests only. */
export async function setTenant(db: Db, tenantId: string | null): Promise<void> {
  await db.execute(sql`select set_config('app.tenant_id', ${tenantId ?? ''}, false)`);
}

/**
 * A tenant with an owner, ready to act. Written as the superuser, because creating a tenant
 * is exactly the operation that cannot be scoped to one.
 */
/** A plan from the catalogue drizzle/0006 seeds (P2.1): tests subscribe stores to the real rows. */
export async function seededPlanId(harness: TestDb, code: (typeof schema.PLAN_CODE)[number]): Promise<string> {
  const [row] = await harness.asAdmin(() => harness.db.select({ id: schema.plans.id }).from(schema.plans).where(eq(schema.plans.code, code)));
  if (!row) throw new Error(`plan "${code}" is not seeded — is drizzle/0006 applied?`);
  return row.id;
}

/**
 * Switch a feature on for a plan in this test database's catalogue (the catalogue is data, T19) —
 * for a test about something other than plans that needs a gated feature on a plan whose other
 * numbers it relies on (the AI tests keep Starter's 5 credits and switch `ai_3d` on).
 */
export async function enablePlanFeature(harness: TestDb, code: (typeof schema.PLAN_CODE)[number], feature: string): Promise<void> {
  const planId = await seededPlanId(harness, code);
  await harness.asAdmin(() => harness.db.insert(schema.planFeatures).values({ planId, featureKey: feature, enabled: true } as any).onConflictDoNothing());
}

/**
 * A store with its owner. `plan` subscribes it (active, this month) — for tests that use a plan
 * feature: store platforms need Growth, AI 3D work needs Pro (T35). Without it the store has no
 * subscription and is not on trial, so it is on Starter.
 */
export async function seedTenant(harness: TestDb, name: string, options: { plan?: (typeof schema.PLAN_CODE)[number] } = {}): Promise<{
  tenantId: string; userId: string; email: string;
}> {
  const tenantId = uuidv7();
  const userId = uuidv7();
  const email = `${name}@example.test`;

  await harness.asAdmin(async () => {
    await harness.db.insert(schema.tenants).values({
      id: tenantId, slug: name, name, status: 'active',
    } as any);
    await harness.db.insert(schema.users).values({
      id: userId, email, passwordHash: 'pbkdf2$sha256$1$x$x', fullName: name,
    } as any);
    await harness.db.insert(schema.tenantMemberships).values({
      id: uuidv7(), tenantId, userId, role: 'owner', status: 'active',
    } as any);
  });

  if (options.plan) {
    const planId = await seededPlanId(harness, options.plan);
    const now = new Date();
    await harness.asAdmin(() => harness.db.insert(schema.subscriptions).values({
      tenantId, planId, status: 'active', currentPeriodStart: now, currentPeriodEnd: new Date(now.getTime() + 30 * 86_400_000),
    } as any));
  }
  return { tenantId, userId, email };
}

/** Assert that `fn` rejects or returns nothing useful. Used by the isolation suite. */
export async function denied(fn: () => Promise<unknown>): Promise<'threw' | 'empty' | 'LEAKED'> {
  try {
    const result = await fn();
    if (result === null || result === undefined) return 'empty';
    if (Array.isArray(result) && result.length === 0) return 'empty';
    if (typeof result === 'number' && result === 0) return 'empty';
    if (typeof result === 'boolean' && result === false) return 'empty';
    return 'LEAKED';
  } catch {
    return 'threw';
  }
}
