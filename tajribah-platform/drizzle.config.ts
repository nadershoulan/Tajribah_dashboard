import { defineConfig } from 'drizzle-kit';

/**
 * PostgreSQL 16+ (T1, superseded by T9): row-level security is the isolation guarantee, and
 * only Postgres provides it.
 *
 * Generated SQL is reviewed by hand before it runs anywhere, and every migration file carries
 * a `-- ROLLBACK:` block (§7.11).
 */
export default defineConfig({
  dialect: 'postgresql',
  schema: './db/schema/index.ts',
  out: './drizzle',
  strict: true,
  verbose: true,
});
