/**
 * T115 — the contact inbox for staff («رسائل التواصل»): every message the website's form kept, newest first,
 * filtered by status with a count of each. Reading is not a staff action; moving a message (read, archived,
 * back to new) and deleting one are, and go into the staff trail — a deletion with its reason.
 */
import { and, count, desc, eq, lt, type SQL } from 'drizzle-orm';
import { unsafeAdminDb, type Db } from '@/db/client';
import { contactMessages, type ContactMessage } from '@/db/schema';
import { errors } from '@/server/core/errors/problem';
import { staffLog, type StaffContext } from './access';

export const CONTACT_STATUSES = ['new', 'read', 'archived'] as const;
export type ContactStatus = (typeof CONTACT_STATUSES)[number];
const PAGE = 100;

export type ContactItem = {
  id: string; name: string; email: string; phone: string | null; storeUrl: string | null; platform: string | null;
  message: string; lang: string; status: ContactStatus; createdAt: string; handledAt: string | null;
};
export type ContactInbox = { items: ContactItem[]; counts: Record<ContactStatus, number>; next: string | null };

const view = (r: ContactMessage): ContactItem => ({
  id: r.id, name: r.name, email: r.email, phone: r.phone, storeUrl: r.storeUrl, platform: r.platform,
  message: r.message, lang: r.lang, status: r.status, createdAt: r.createdAt.toISOString(), handledAt: r.handledAt?.toISOString() ?? null,
});

/** `status` all or one; `before` is the last item's createdAt (ISO) for the next page. */
export async function contactInbox(filter: { status?: ContactStatus | 'all'; before?: string } = {}): Promise<ContactInbox> {
  const db = unsafeAdminDb();
  const where: SQL[] = [];
  if (filter.status && filter.status !== 'all') where.push(eq(contactMessages.status, filter.status));
  if (filter.before) {
    const before = new Date(filter.before);
    if (Number.isNaN(before.getTime())) throw errors.validation({ before: ['a date'] });
    where.push(lt(contactMessages.createdAt, before));
  }
  const rows = await db.select().from(contactMessages).where(where.length ? and(...where) : undefined).orderBy(desc(contactMessages.createdAt)).limit(PAGE + 1);
  const tallies = await db.select({ status: contactMessages.status, n: count() }).from(contactMessages).groupBy(contactMessages.status);
  const counts = { new: 0, read: 0, archived: 0 } as Record<ContactStatus, number>;
  for (const t of tallies) counts[t.status] = Number(t.n);
  const items = rows.slice(0, PAGE).map(view);
  return { items, counts, next: rows.length > PAGE ? items[items.length - 1]!.createdAt : null };
}

export async function setContactStatus(staff: StaffContext, id: string, status: ContactStatus, now = new Date()): Promise<ContactItem> {
  if (!CONTACT_STATUSES.includes(status)) throw errors.validation({ status: ['new, read or archived'] });
  return unsafeAdminDb().transaction(async (tx) => {
    const [before] = await tx.select().from(contactMessages).where(eq(contactMessages.id, id)).limit(1);
    if (!before) throw errors.notFound('message');
    const [row] = await tx.update(contactMessages)
      .set({ status, handledBy: status === 'new' ? null : staff.userId, handledAt: status === 'new' ? null : now, updatedAt: now })
      .where(eq(contactMessages.id, id)).returning();
    if (before.status !== status) {
      await staffLog(staff, { action: 'contact.status', targetType: 'contact_message', targetId: id, detail: { from: before.status, to: status } }, tx as unknown as Db);
    }
    return view(row!);
  });
}

/** Gone for good (spam, or a privacy request) — with a reason in the staff trail; the trail keeps no message text. */
export async function deleteContact(staff: StaffContext, id: string, reason: string): Promise<void> {
  const why = reason.trim();
  if (why.length < 5) throw errors.validation({ reason: ['say why, in a few words'] });
  await unsafeAdminDb().transaction(async (tx) => {
    const [gone] = await tx.delete(contactMessages).where(eq(contactMessages.id, id)).returning({ id: contactMessages.id, status: contactMessages.status });
    if (!gone) throw errors.notFound('message');
    await staffLog(staff, { action: 'contact.delete', targetType: 'contact_message', targetId: id, reason: why, detail: { status: gone.status } }, tx as unknown as Db);
  });
}
