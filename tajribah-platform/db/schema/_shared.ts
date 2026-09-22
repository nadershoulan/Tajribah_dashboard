/**
 * Column helpers shared by every table (§7.2).
 *
 * This file imports no tables, so table files can import it freely without a cycle.
 *
 * PostgreSQL, because the target is thousands of tenants and tens of millions of rows: the
 * isolation guarantee is row-level security (§4 D1, §7.1), which only Postgres gives us.
 */
import { integer, timestamp, uuid, jsonb, boolean, char } from 'drizzle-orm/pg-core';
// Relative, not `@/lib/ids`: drizzle-kit loads this file outside the bundler, so the
// tsconfig path alias would not resolve when generating migrations.
import { uuidv7 } from '../../lib/ids';

/** uuid v7 primary key — time-ordered, so inserts stay local in the index. */
export const pk = () => uuid('id').primaryKey().$defaultFn(() => uuidv7());

/**
 * The tenant discriminator. Present on every tenant-scoped table; it is what the RLS policy
 * compares against `current_tenant_id()`, and what the isolation suite looks for when it
 * walks the schema. The foreign key is declared in the table file, not here, to keep this
 * file table-free.
 */
export const tenantId = () => uuid('tenant_id').notNull();

export const createdAt = () =>
  timestamp('created_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow();

export const updatedAt = () =>
  timestamp('updated_at', { withTimezone: true, mode: 'date' }).notNull().defaultNow().$onUpdateFn(() => new Date());

/** Soft delete, only where recovery actually matters. Filter with `isNull(deleted_at)`. */
export const deletedAt = () => timestamp('deleted_at', { withTimezone: true, mode: 'date' });

export const timestamps = () => ({ createdAt: createdAt(), updatedAt: updatedAt() });

export const ts = (name: string) => timestamp(name, { withTimezone: true, mode: 'date' });

/**
 * Money: an integer count of minor units plus an explicit currency (T5). `numeric(12,2)`
 * would be exact too, but every read would cross a string boundary and arithmetic would
 * drift back into floats in JavaScript. `bigint` is not needed — 2^31 halalas is 21M SAR,
 * and any single amount above that is a contract, not a subscription line.
 */
export const amountMinor = (name: string) => integer(name).notNull();
export const currency = (name = 'currency') => char(name, { length: 3 }).notNull().default('SAR');

/** JSONB for provider-specific payloads only — never for queryable business data. */
export const json = <T>(name: string) => jsonb(name).$type<T>();

export const bool = (name: string) => boolean(name).notNull();
