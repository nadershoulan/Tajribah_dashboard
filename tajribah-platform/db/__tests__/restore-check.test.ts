/**
 * P7 — disaster recovery: the restore check (`scripts/dr/compare.mjs`, which `scripts/dr/drill.mjs`
 * runs against real Postgres) says a restore is whole only when it is: the same schema, the same
 * row-level security policies, every table with the same rows, security on and forced wherever it
 * was, and one store unable to read another's rows — with a probe that actually read something.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { compareRestore, type RestoredFacts } from '../../scripts/dr/compare.mjs';

const MANIFEST = {
  schema: 'abc', policies: 2,
  tables: {
    products: { rows: 650, rls: true, forced: true },
    plans: { rows: 4, rls: false, forced: false },
  },
};
const whole = (): RestoredFacts => ({ ...structuredClone(MANIFEST), crossTenantRows: 0, ownRows: 400 });

test('a whole restore passes', () => {
  assert.deepEqual(compareRestore(MANIFEST, whole()), { ok: true, problems: [] });
});

test('each way a restore can be less than whole is named', () => {
  const cases: [string, (r: RestoredFacts) => void, RegExp][] = [
    ['a row lost', (r) => { r.tables.products!.rows = 649; }, /products: 650 rows backed up, 649 restored/],
    ['a table missing', (r) => { delete r.tables.plans; }, /plans: missing from the restore/],
    ['a table that was not backed up', (r) => { r.tables.extra = { rows: 0, rls: false, forced: false }; }, /extra: in the restore but not in the backup/],
    ['security off', (r) => { r.tables.products!.rls = false; }, /row-level security is off/],
    ['security not forced', (r) => { r.tables.products!.forced = false; }, /no longer forced/],
    ['a policy lost', (r) => { r.policies = 1; }, /policies: 2 .* 1 restored/],
    ['the schema changed', (r) => { r.schema = 'abd'; }, /schema:/],
    ['one store reads another', (r) => { r.crossTenantRows = 3; }, /read 3 rows of another store/],
    ['a probe that read nothing', (r) => { r.ownRows = 0; }, /proves nothing/],
  ];
  for (const [what, damage, expected] of cases) {
    const restored = whole();
    damage(restored);
    const result = compareRestore(MANIFEST, restored);
    assert.equal(result.ok, false, what);
    assert.equal(result.problems.length, 1, `${what}: exactly its own problem — ${result.problems.join(' | ')}`);
    assert.match(result.problems[0]!, expected, what);
  }
});
