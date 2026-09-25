/**
 * P1.23 — in-app notifications: the few events worth interrupting someone for.
 *
 * One row per person, not per store: a notification is written for every active member
 * whose role can see what it is about (`permission`), inside the transaction of the event
 * itself — no event without its notification, and no notification for an event that rolled
 * back. Reading one marks it read for that person only.
 *
 * Deliberately not notified: routine successes (an hourly sync that went fine), anything
 * already on the screen that caused it. A bell that rings for everything is ignored.
 */
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import { notifications, tenantMemberships } from '@/db/schema';
import { uuidv7 } from '@/lib/ids';
import type { Bi } from '@/lib/lang';
import type { NotificationItem } from '@/lib/view-models';
import { permissionsFor, type Permission } from '@/server/core/rbac/permissions';
import type { TenantContext } from '@/server/core/tenancy/context';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';
import { withTenant } from '@/server/core/tenancy/rls';

export type NotifyInput = {
  type: string;
  title: Bi;
  body?: Bi | null;
  href?: string | null;
  level?: 'info' | 'success' | 'warning' | 'error';
  /** Everyone whose role has this permission… */
  permission?: Permission;
  /** …or exactly these people. */
  userIds?: string[];
};

/** The shape the bell reads (lib/view-models). */
export type NotificationRow = NotificationItem;

/** Write the notification for its audience, in the caller's transaction (`db`). */
export async function notifyIn(db: TenantDb, input: NotifyInput): Promise<number> {
  let userIds = input.userIds ?? [];
  if (input.permission) {
    const members = await db.find(tenantMemberships, eq(tenantMemberships.status, 'active'), { limit: 500 });
    userIds = members.filter((m) => permissionsFor(m.role).has(input.permission!)).map((m) => m.userId);
  }
  if (!userIds.length) return 0;
  await db.insert(notifications, userIds.map((userId) => ({
    id: uuidv7(), tenantId: db.tenantId, userId, type: input.type,
    titleAr: input.title.ar, titleEn: input.title.en, bodyAr: input.body?.ar ?? null, bodyEn: input.body?.en ?? null,
    href: input.href ?? null, level: input.level ?? 'info',
  })));
  return userIds.length;
}

export async function myNotifications(ctx: TenantContext, limit = 30): Promise<{ items: NotificationRow[]; unread: number }> {
  const mine = eq(notifications.userId, ctx.actor.userId);
  const rows = await ctx.db.find(notifications, mine, { limit, orderBy: desc(notifications.createdAt) });
  const unread = await ctx.db.count(notifications, and(mine, isNull(notifications.readAt)));
  return {
    unread,
    items: rows.map((n) => ({
      id: n.id, type: n.type, title: { ar: n.titleAr, en: n.titleEn },
      body: n.bodyAr || n.bodyEn ? { ar: n.bodyAr ?? n.bodyEn ?? '', en: n.bodyEn ?? n.bodyAr ?? '' } : null,
      href: n.href, level: n.level, read: !!n.readAt, createdAt: n.createdAt.toISOString(),
    })),
  };
}

/** Mark some (or all) of the caller's own notifications read. Others' rows are never touched. */
export async function markRead(ctx: TenantContext, ids: string[] | 'all'): Promise<number> {
  const mine = and(eq(notifications.userId, ctx.actor.userId), isNull(notifications.readAt));
  const where = ids === 'all' ? mine! : and(mine, inArray(notifications.id, ids.length ? ids : ['00000000-0000-0000-0000-000000000000']))!;
  // Not audited: it is one person's own inbox state, not a change to the store. Written in
  // an RLS transaction like every other write, just without an audit row.
  const updated = await withTenant(ctx.tenantId, (db) => db.update(notifications, where, { readAt: new Date() }));
  return updated.length;
}
