/**
 * P7 — every migration can run while the previous version is still serving (expand, then
 * contract once nothing uses the old shape). The rules: `server/testing/migration-safety.ts`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { migrationProblems } from '@/server/testing/migration-safety';

const dir = join(process.cwd(), 'drizzle');
const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

/**
 * Written before launch, with no running version to break — and read here, so the checker is
 * shown to catch real cases: 0002 swaps `sync_job_items` for a partitioned table (rename, create,
 * copy, drop); 0009 adds a unique index to `credit_ledger`. Nothing after 0018 is exempt.
 */
const BEFORE_LAUNCH: Record<string, string[]> = {
  '0002_partition_sync_job_items.sql': ['contract', 'contract', 'contract'],
  '0009_credit_ledger_references.sql': ['locks'],
};

test('every migration can run while the previous version is still serving', () => {
  for (const file of files) {
    const found = migrationProblems(file, readFileSync(join(dir, file), 'utf8')).map((p) => p.rule);
    assert.deepEqual(found, BEFORE_LAUNCH[file] ?? [], `${file}: ${found.length ? 'a change the running version cannot survive — expand first; contract with a "-- contract:" line once nothing uses it; mark a small table\'s index "-- lock-ok:"' : 'no longer needs its exemption'}`);
  }
  for (const file of Object.keys(BEFORE_LAUNCH)) assert.ok(file < '0019', `${file}: only pre-launch migrations are exempt`);
});

const m = (forward: string, rollback = 'DROP TABLE "x";') => `${forward}\n\n-- ROLLBACK:\n-- ${rollback}\n`;
const rules = (sql: string) => migrationProblems('t.sql', sql).map((p) => p.rule);

test('the rules, statement by statement', () => {
  // Contract changes need a reason line.
  for (const sql of [
    'ALTER TABLE "products" DROP COLUMN "sku";',
    'DROP TABLE "products";',
    'ALTER TABLE "products" RENAME COLUMN "sku" TO "code";',
    'ALTER TABLE "products" RENAME TO "items";',
    'ALTER TABLE "products" ALTER COLUMN "sku" SET DATA TYPE varchar(40);',
    'ALTER TABLE "products" ALTER COLUMN "sku" TYPE varchar(40);',
    'ALTER TABLE "products" ALTER COLUMN "sku" SET NOT NULL;',
    'DROP TYPE "provider";',
    'ALTER TYPE "provider" RENAME VALUE \'zid\' TO \'zid2\';',
  ]) {
    assert.deepEqual(rules(m(sql)), ['contract'], sql);
    assert.deepEqual(rules(m(`-- contract: the code stopped using it in P9.9\n${sql}`)), [], `with a reason: ${sql}`);
    assert.deepEqual(rules(m('-- contract:\n' + sql)), ['contract'], 'a bare marker is not a reason');
  }
  // A new NOT NULL column needs a default — no marker excuses it.
  assert.deepEqual(rules(m('ALTER TABLE "products" ADD COLUMN "weight" integer NOT NULL;')), ['not_null_without_default']);
  assert.deepEqual(rules(m('-- contract: x\n-- lock-ok: x\nALTER TABLE "products" ADD COLUMN "weight" integer NOT NULL;')), ['not_null_without_default']);
  assert.deepEqual(rules(m('ALTER TABLE "products" ADD COLUMN "weight" integer DEFAULT 0 NOT NULL;')), []);
  assert.deepEqual(rules(m('ALTER TABLE "products" ADD COLUMN "weight" integer;')), []);
  // Locks: an index or a validated constraint on an existing table.
  assert.deepEqual(rules(m('CREATE INDEX "p_idx" ON "products" ("sku");')), ['locks']);
  assert.deepEqual(rules(m('CREATE UNIQUE INDEX "p_unq" ON "products" USING btree ("sku");')), ['locks']);
  assert.deepEqual(rules(m('CREATE INDEX CONCURRENTLY "p_idx" ON "products" ("sku");')), []);
  assert.deepEqual(rules(m('-- lock-ok: 12 rows, the plan catalogue\nCREATE INDEX "p_idx" ON "plans" ("code");')), []);
  assert.deepEqual(rules(m('ALTER TABLE "products" ADD CONSTRAINT "p_fk" FOREIGN KEY ("t") REFERENCES "tenants"("id");')), ['locks']);
  assert.deepEqual(rules(m('ALTER TABLE "products" ADD CONSTRAINT "p_fk" FOREIGN KEY ("t") REFERENCES "tenants"("id") NOT VALID;')), []);
  // Relaxing is always safe.
  assert.deepEqual(rules(m('ALTER TABLE "products" ALTER COLUMN "sku" DROP NOT NULL;')), []);
  // A table made earlier in the same migration is new; a swap (rename away, then create) is not.
  assert.deepEqual(rules(m('CREATE TABLE "things" ("id" uuid);\n--> statement-breakpoint\nCREATE INDEX "t_idx" ON "things" ("id");\n--> statement-breakpoint\nALTER TABLE "things" ADD COLUMN "n" integer NOT NULL;')), []);
  assert.deepEqual(rules(m('ALTER TABLE "things" RENAME TO "things_old";\n--> statement-breakpoint\nCREATE TABLE "things" ("id" uuid);')), ['contract']);
  // The rollback undoes on purpose; it is not checked.
  assert.deepEqual(rules(m('ALTER TABLE "products" ADD COLUMN "weight" integer;', 'ALTER TABLE "products" DROP COLUMN "weight";')), []);
});
