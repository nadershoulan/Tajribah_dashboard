/**
 * A13 — announcements, for staff (T23): the platform copy that changes on staff's schedule, not a
 * release's. A bilingual notice with a start and an end, shown on every store's dashboard while
 * active. Both languages are required — a store reading Arabic must never see an English-only
 * notice. A link, if any, stays inside the dashboard. Every change is in the staff trail.
 */
import { and, asc, desc, eq, gt, lte } from 'drizzle-orm';
import { unsafeAdminDb, type Db } from '@/db/client';
import { announcements, type Announcement } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import type { Bi } from '@/lib/lang';
import { errors } from '@/server/core/errors/problem';
import { staffLog, type StaffContext } from './access';

export type AnnouncementFields = {
  titleAr: string; titleEn: string; bodyAr: string | null; bodyEn: string | null;
  level: 'info' | 'warning'; link: string | null; startsAt: string; endsAt: string; active: boolean;
};
export type AdminAnnouncement = AnnouncementFields & { id: string; createdAt: string; live: boolean };

const MAX_DAYS = 90;

const view = (a: Announcement, now: Date): AdminAnnouncement => ({
  id: a.id, titleAr: a.titleAr, titleEn: a.titleEn, bodyAr: a.bodyAr, bodyEn: a.bodyEn, level: a.level, link: a.link,
  startsAt: a.startsAt.toISOString(), endsAt: a.endsAt.toISOString(), active: a.active, createdAt: a.createdAt.toISOString(),
  live: a.active && a.startsAt.getTime() <= now.getTime() && a.endsAt.getTime() > now.getTime(),
});

function problems(f: AnnouncementFields): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  if (!f.titleAr.trim() || f.titleAr.length > 120) out.titleAr = ['1 to 120 characters'];
  if (!f.titleEn.trim() || f.titleEn.length > 120) out.titleEn = ['1 to 120 characters'];
  if ((f.bodyAr?.length ?? 0) > 500) out.bodyAr = ['500 characters at most'];
  if ((f.bodyEn?.length ?? 0) > 500) out.bodyEn = ['500 characters at most'];
  if (!!f.bodyAr?.trim() !== !!f.bodyEn?.trim()) out.bodyEn = ['both languages, or neither'];
  if (f.link !== null && !/^\/dashboard(\/[A-Za-z0-9/_-]*)?$/.test(f.link)) out.link = ['a dashboard path, like /dashboard/billing'];
  const start = Date.parse(f.startsAt);
  const end = Date.parse(f.endsAt);
  if (Number.isNaN(start) || Number.isNaN(end)) out.startsAt = ['a date and time'];
  else if (end <= start) out.endsAt = ['after the start'];
  else if (end - start > MAX_DAYS * 86_400_000) out.endsAt = [`at most ${MAX_DAYS} days after the start`];
  return out;
}

const row = (f: AnnouncementFields) => ({
  titleAr: f.titleAr.trim(), titleEn: f.titleEn.trim(), bodyAr: f.bodyAr?.trim() || null, bodyEn: f.bodyEn?.trim() || null,
  level: f.level, link: f.link, startsAt: new Date(f.startsAt), endsAt: new Date(f.endsAt), active: f.active,
});

function needReason(reason: string): string {
  const r = reason.trim();
  if (r.length < 5) throw errors.validation({ reason: ['say why, in a few words'] });
  return r;
}

export async function listAnnouncements(now = new Date()): Promise<AdminAnnouncement[]> {
  const rows = await unsafeAdminDb().select().from(announcements).orderBy(desc(announcements.startsAt)).limit(200);
  return rows.map((a) => view(a, now));
}

export async function createAnnouncement(staff: StaffContext, input: AnnouncementFields & { reason: string }, now = new Date()): Promise<AdminAnnouncement> {
  const reason = needReason(input.reason);
  const bad = problems(input);
  if (Object.keys(bad).length) throw errors.validation(bad);
  return unsafeAdminDb().transaction(async (tx) => {
    const [created] = await tx.insert(announcements).values({ id: uuidv7(), ...row(input), createdBy: staff.userId }).returning();
    await staffLog(staff, { action: 'announcement.create', targetType: 'announcement', targetId: created!.id, reason, detail: { titleEn: created!.titleEn, startsAt: input.startsAt, endsAt: input.endsAt } }, tx as unknown as Db);
    return view(created!, now);
  });
}

export async function updateAnnouncement(staff: StaffContext, id: string, patch: Partial<AnnouncementFields> & { reason: string }, now = new Date()): Promise<AdminAnnouncement> {
  const reason = needReason(patch.reason);
  return unsafeAdminDb().transaction(async (tx) => {
    const [current] = await tx.select().from(announcements).where(eq(announcements.id, id)).for('update');
    if (!current) throw errors.notFound('announcement');
    const before = view(current, now);
    const { reason: _r, ...changes } = patch;
    void _r;
    const after: AnnouncementFields = { ...before, ...changes };
    const changed = (Object.keys(after) as (keyof AnnouncementFields)[]).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(before[k]));
    if (!changed.length) throw errors.conflict('nothing changed');
    const bad = problems(after);
    if (Object.keys(bad).length) throw errors.validation(bad);
    const [saved] = await tx.update(announcements).set({ ...row(after), updatedAt: now }).where(eq(announcements.id, id)).returning();
    await staffLog(staff, { action: 'announcement.update', targetType: 'announcement', targetId: id, reason, detail: { changes: Object.fromEntries(changed.map((k) => [k, { from: before[k], to: after[k] }])) } }, tx as unknown as Db);
    return view(saved!, now);
  });
}

export type LiveAnnouncement = { id: string; level: 'info' | 'warning'; title: Bi; body: Bi | null; link: string | null; endsAt: string };

/**
 * The announcements live now, for every signed-in dashboard (API-112). A platform catalogue read,
 * like `planCatalogue`: the app role may only read the table (drizzle/0015, tested), and this
 * function only selects.
 */
export async function liveAnnouncements(now = new Date()): Promise<LiveAnnouncement[]> {
  const rows = await unsafeAdminDb().select().from(announcements)
    .where(and(eq(announcements.active, true), lte(announcements.startsAt, now), gt(announcements.endsAt, now)))
    .orderBy(asc(announcements.startsAt)).limit(5);
  return rows.map((a) => ({
    id: a.id, level: a.level, title: { ar: a.titleAr, en: a.titleEn },
    body: a.bodyAr && a.bodyEn ? { ar: a.bodyAr, en: a.bodyEn } : null, link: a.link, endsAt: a.endsAt.toISOString(),
  }));
}
