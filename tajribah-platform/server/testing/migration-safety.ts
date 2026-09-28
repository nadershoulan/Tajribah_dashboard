/**
 * P7 (zero-downtime deployment, the code-level part) — can this migration run while the previous
 * version of the app is still serving? During a rollout both versions talk to one database, so a
 * migration must only **expand** (add) until no running code needs what it would take away.
 *
 * Per statement of a migration's forward part (the `-- ROLLBACK:` block is exempt — it undoes):
 *  - **contract** changes break the version still running, so they need a `-- contract: <why it
 *    is safe now>` line — written only once no deployed code reads or writes the thing:
 *    DROP TABLE / DROP COLUMN, RENAME (table or column), a column's TYPE, SET NOT NULL on an
 *    existing column, DROP TYPE, renaming a type or an enum value.
 *  - **never**: ADD COLUMN … NOT NULL without a DEFAULT on an existing table — the running
 *    version's inserts fail at once.
 *  - **locks**: a new index (without CONCURRENTLY), or a constraint that is not NOT VALID, on an
 *    existing table blocks writes while it builds, so it needs `-- lock-ok: <why>` (the table is
 *    small, say). A CONCURRENTLY index must run outside a transaction — the production runner has
 *    to allow that when it is built.
 * A table created earlier in the same migration is new: nothing running uses it yet, so anything goes.
 */
export type MigrationProblem = { file: string; statement: string; rule: 'contract' | 'not_null_without_default' | 'locks' };

const strip = (sql: string) => sql.replace(/--[^\n]*/g, '').replace(/\s+/g, ' ').trim();
const name = (raw: string) => raw.replace(/"/g, '').toLowerCase();

export function migrationProblems(file: string, sql: string): MigrationProblem[] {
  const forward = sql.split('-- ROLLBACK:')[0] ?? '';
  // The reason must be on the marker's own line: a bare "-- contract:" is no reason.
  const contract = /^--[ \t]*contract:[ \t]*\S/m.test(forward);
  const lockOk = /^--[ \t]*lock-ok:[ \t]*\S/m.test(forward);
  const statements = forward.split(/-->\s*statement-breakpoint|;\s*\n/).map(strip).filter(Boolean);
  // Only a table created *earlier in this migration* is new — renaming a table away and creating
  // a new one under its name (a swap) is still a change to the one the running version uses.
  const created = new Set<string>();
  const target = (s: string) => {
    const m = /^(?:ALTER TABLE (?:ONLY )?(?:IF EXISTS )?|CREATE (?:UNIQUE )?INDEX (?:CONCURRENTLY )?(?:IF NOT EXISTS )?"?\w+"? ON (?:ONLY )?)("?[\w.]+"?)/i.exec(s);
    return m ? name(m[1]!) : null;
  };
  const problems: MigrationProblem[] = [];
  for (const statement of statements) {
    const made = /^CREATE TABLE (?:IF NOT EXISTS )?("?[\w.]+"?)/i.exec(statement);
    if (made) { created.add(name(made[1]!)); continue; }
    const table = target(statement);
    if (table && created.has(table)) continue; // new in this migration: nothing running uses it
    const add = (rule: MigrationProblem['rule']) => problems.push({ file, statement: statement.slice(0, 160), rule });
    if (/^DROP TABLE\b/i.test(statement) || /^DROP TYPE\b/i.test(statement)
      || /^ALTER TABLE\b.*\b(DROP COLUMN|RENAME\b)/i.test(statement)
      || /^ALTER TABLE\b.*\bALTER COLUMN\b.*\b(SET DATA TYPE|TYPE)\b/i.test(statement)
      || /^ALTER TABLE\b.*\bALTER COLUMN\b.*\bSET NOT NULL\b/i.test(statement)
      || /^ALTER TYPE\b.*\bRENAME\b/i.test(statement)) {
      if (!contract) add('contract');
      continue;
    }
    if (/^ALTER TABLE\b.*\bADD COLUMN\b.*\bNOT NULL\b/i.test(statement) && !/\bDEFAULT\b/i.test(statement)) { add('not_null_without_default'); continue; }
    if ((/^CREATE (UNIQUE )?INDEX\b/i.test(statement) && !/\bCONCURRENTLY\b/i.test(statement))
      || (/^ALTER TABLE\b.*\bADD CONSTRAINT\b.*\b(FOREIGN KEY|CHECK|UNIQUE|PRIMARY KEY)\b/i.test(statement) && !/\bNOT VALID\b/i.test(statement))) {
      if (!lockOk) add('locks');
    }
  }
  return problems;
}
