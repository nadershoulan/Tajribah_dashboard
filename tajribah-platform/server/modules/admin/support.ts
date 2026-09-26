/**
 * A12 — support tooling: paste whatever the merchant gave you and see what it is and what
 * happened.
 *
 * One box takes a store / person / invoice / job / delivery id, an email, an invoice number, a
 * name or web address, or a **request id** (every error the dashboard shows carries one). A
 * request id answers "what did that request do?": its rows in every store's activity trail and
 * in the staff trail, in order.
 *
 * Trails are shown by **which fields changed, not their values**: enough to see what happened,
 * without copying a store's data (or a token's ciphertext) onto a support screen.
 */
import { and, asc, desc, eq, ilike, inArray, lt, or } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { auditLogs, invoices, jobs, staffAudit, tenants, users, webhookEvents } from '@/db/schema';
import { errors } from '@/server/core/errors/problem';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REQUEST_ID = /^[A-Za-z0-9_-]{8,64}$/; // what `requestIdFrom` accepts

type StoreRef = { id: string; name: string; nameAr: string | null; slug: string; status: string };
export type TrailEntry = {
  id: string; at: string; source: 'store' | 'staff'; store: { id: string; name: string; nameAr: string | null } | null;
  actorType: string; actor: string | null; action: string; resourceType: string; resourceId: string | null;
  requestId: string | null; fields: string[]; reason: string | null;
};
export type Lookup = {
  kind: 'id' | 'email' | 'invoice-number' | 'text';
  stores: StoreRef[];
  people: { id: string; email: string; fullName: string }[];
  invoices: { id: string; number: string; status: string; store: StoreRef }[];
  jobs: { id: string; queue: string; state: string; storeId: string | null }[];
  deliveries: { id: string; provider: string; topic: string; status: string; storeId: string }[];
  /** Everything recorded under this request id, oldest first; empty when it is not one. */
  request: TrailEntry[];
};

const fieldsOf = (changes: { before?: Record<string, unknown>; after?: Record<string, unknown> } | null) =>
  [...new Set([...Object.keys(changes?.before ?? {}), ...Object.keys(changes?.after ?? {})])].sort();
const escape = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);
const storeRef = (t: typeof tenants.$inferSelect): StoreRef => ({ id: t.id, name: t.name, nameAr: t.nameAr, slug: t.slug, status: t.status });

export async function lookup(input: string): Promise<Lookup> {
  const q = input.trim();
  if (q.length < 2 || q.length > 200) throw errors.validation({ q: ['2 to 200 characters'] });
  const db = unsafeAdminDb(); // support reads across every store (A1)
  const out: Lookup = { kind: 'text', stores: [], people: [], invoices: [], jobs: [], deliveries: [], request: [] };
  const live = (t: typeof tenants.$inferSelect) => !t.deletedAt;

  if (UUID.test(q)) {
    out.kind = 'id';
    const id = q.toLowerCase();
    const [store, person, invoice, job, delivery] = await Promise.all([
      db.select().from(tenants).where(eq(tenants.id, id)).limit(1),
      db.select().from(users).where(eq(users.id, id)).limit(1),
      db.select({ invoice: invoices, tenant: tenants }).from(invoices).innerJoin(tenants, eq(tenants.id, invoices.tenantId)).where(eq(invoices.id, id)).limit(1),
      db.select().from(jobs).where(eq(jobs.id, id)).limit(1),
      db.select().from(webhookEvents).where(eq(webhookEvents.id, id)).limit(1),
    ]);
    out.stores = store.filter(live).map(storeRef);
    out.people = person.filter((p) => !p.deletedAt).map((p) => ({ id: p.id, email: p.email, fullName: p.fullName }));
    out.invoices = invoice.filter((r) => live(r.tenant)).map((r) => ({ id: r.invoice.id, number: r.invoice.invoiceNumber, status: r.invoice.status, store: storeRef(r.tenant) }));
    out.jobs = job.map((j) => ({ id: j.id, queue: j.queue, state: j.state, storeId: j.tenantId }));
    out.deliveries = delivery.map((d) => ({ id: d.id, provider: d.provider, topic: d.topic, status: d.status, storeId: d.tenantId }));
  } else if (q.includes('@')) {
    out.kind = 'email';
    const people = await db.select().from(users).where(ilike(users.email, escape(q))).limit(5);
    out.people = people.filter((p) => !p.deletedAt).map((p) => ({ id: p.id, email: p.email, fullName: p.fullName }));
  } else if (/^TJ-/i.test(q)) {
    out.kind = 'invoice-number';
    const rows = await db.select({ invoice: invoices, tenant: tenants }).from(invoices).innerJoin(tenants, eq(tenants.id, invoices.tenantId))
      .where(ilike(invoices.invoiceNumber, escape(q))).limit(5);
    out.invoices = rows.filter((r) => live(r.tenant)).map((r) => ({ id: r.invoice.id, number: r.invoice.invoiceNumber, status: r.invoice.status, store: storeRef(r.tenant) }));
  } else {
    const like = `%${escape(q)}%`;
    const [stores, people] = await Promise.all([
      db.select().from(tenants).where(or(ilike(tenants.name, like), ilike(tenants.nameAr, like), ilike(tenants.slug, like))).orderBy(desc(tenants.id)).limit(6),
      db.select().from(users).where(or(ilike(users.fullName, like), ilike(users.email, like))).orderBy(desc(users.id)).limit(6),
    ]);
    out.stores = stores.filter(live).slice(0, 5).map(storeRef);
    out.people = people.filter((p) => !p.deletedAt).slice(0, 5).map((p) => ({ id: p.id, email: p.email, fullName: p.fullName }));
  }

  // Any well-formed id may also be a request id — uuids included (the server mints uuidv7s).
  if (REQUEST_ID.test(q)) out.request = await requestTrail(q);
  return out;
}

/** Everything one request did: store trail rows (any store) and staff trail rows, oldest first. */
export async function requestTrail(requestId: string): Promise<TrailEntry[]> {
  const db = unsafeAdminDb();
  const [storeRows, staffRows] = await Promise.all([
    db.select({ row: auditLogs, tenant: tenants }).from(auditLogs).leftJoin(tenants, eq(tenants.id, auditLogs.tenantId))
      .where(eq(auditLogs.requestId, requestId)).orderBy(asc(auditLogs.createdAt), asc(auditLogs.id)).limit(100),
    db.select({ row: staffAudit, tenant: tenants }).from(staffAudit).leftJoin(tenants, eq(tenants.id, staffAudit.storeId))
      .where(eq(staffAudit.requestId, requestId)).orderBy(asc(staffAudit.createdAt), asc(staffAudit.id)).limit(100),
  ]);
  const emails = await emailsOf([...storeRows.map((r) => r.row.actorUserId), ...staffRows.map((r) => r.row.staffUserId)]);
  const entries: TrailEntry[] = [
    ...storeRows.map(({ row, tenant }) => storeEntry(row, tenant, emails)),
    ...staffRows.map(({ row, tenant }) => ({
      id: row.id, at: row.createdAt.toISOString(), source: 'staff' as const, store: tenant ? { id: tenant.id, name: tenant.name, nameAr: tenant.nameAr } : null,
      actorType: 'staff', actor: emails.get(row.staffUserId) ?? null, action: row.action, resourceType: row.targetType, resourceId: row.targetId,
      requestId: row.requestId, fields: Object.keys(row.detail ?? {}).sort(), reason: row.reason,
    })),
  ];
  return entries.sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id));
}

/** A store's own activity trail, newest first — what the store did, and what was done to it. */
export async function storeActivity(storeId: string, input: { before?: string; limit?: number } = {}): Promise<{ entries: TrailEntry[]; next: string | null }> {
  const db = unsafeAdminDb();
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, storeId)).limit(1);
  if (!tenant || tenant.deletedAt) throw errors.notFound('store');
  const limit = Math.min(input.limit ?? 50, 100);
  const rows = await db.select().from(auditLogs)
    .where(and(eq(auditLogs.tenantId, storeId), input.before ? lt(auditLogs.id, input.before) : undefined))
    .orderBy(desc(auditLogs.id)).limit(limit + 1);
  const page = rows.slice(0, limit);
  const emails = await emailsOf(page.map((r) => r.actorUserId));
  return { entries: page.map((row) => storeEntry(row, tenant, emails)), next: rows.length > limit ? page.at(-1)!.id : null };
}

function storeEntry(row: typeof auditLogs.$inferSelect, tenant: typeof tenants.$inferSelect | null, emails: Map<string, string>): TrailEntry {
  return {
    id: row.id, at: row.createdAt.toISOString(), source: 'store', store: tenant ? { id: tenant.id, name: tenant.name, nameAr: tenant.nameAr } : null,
    actorType: row.actorType, actor: row.actorUserId ? emails.get(row.actorUserId) ?? null : null, action: row.action,
    resourceType: row.resourceType, resourceId: row.resourceId, requestId: row.requestId, fields: fieldsOf(row.changes), reason: null,
  };
}

async function emailsOf(ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => !!id))];
  if (!wanted.length) return new Map();
  const rows = await unsafeAdminDb().select({ id: users.id, email: users.email }).from(users).where(inArray(users.id, wanted));
  return new Map(rows.map((r) => [r.id, r.email]));
}

