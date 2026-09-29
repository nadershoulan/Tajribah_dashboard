/**
 * P1.24 — the team: who can act for this store, in which role, and inviting more people.
 *
 * Rules that are about people, not plumbing:
 *  - **One owner.** Nobody is invited as, or changed into, the owner; the owner cannot be
 *    demoted or removed here (handing a store over is its own, deliberate flow).
 *  - **No granting above yourself.** An admin can invite and manage admins and below; only
 *    the owner is above an admin. Nobody changes or removes their own membership here.
 *  - **The invitation is for an address, not for whoever has the link.** Accepting needs a
 *    signed-in account with the invited email. The link's token is stored only as a keyed
 *    hash; it is single-use and expires after `INVITE_DAYS`.
 *  - **Pending invitations count against the plan's seats**, or a Starter store could invite
 *    ten people and have them all accept.
 *  - Removal takes effect on the removed person's next request: every request re-reads the
 *    membership (`buildTenantContext`), so there is no window where they keep access.
 *
 * Every change is audited: `invite`, `role_change`, `delete`, and the acceptance as `create`.
 */
import { and, asc, eq, gt, inArray, isNotNull, isNull } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { customRoles, invitations, tenantMemberships, tenants, users } from '@/db/schema';
import { secret, uuidv7 } from '@/lib/ids';
import type { Lang } from '@/lib/lang';
import { CUSTOM_ROLE_PERMISSIONS, MAX_CUSTOM_ROLES, MEMBER_ROLE, type MemberRole } from '@/lib/permissions';
import type { CustomRoleView, TeamMemberRow } from '@/lib/view-models';
import { auditedDelete, auditedInsert, auditedUpdate, record } from '@/server/core/audit/audit';
import { keyedHash } from '@/server/core/auth/crypto';
import { assertFeature, entitlementsOf } from '@/server/core/billing/entitlements';
import { errors } from '@/server/core/errors/problem';
import { LIMITS, rateLimiter } from '@/server/core/ratelimit/limiter';
import { EMAIL, sendEmail } from '@/server/core/notify/messages';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';
import { normaliseEmail } from '@/server/modules/auth/service';
import { UNLIMITED } from '@/lib/plans';
import { notifyIn } from '@/server/modules/notifications/service';

export const INVITE_DAYS = 7;
const RANK: Record<MemberRole, number> = { owner: 5, admin: 4, editor: 3, analyst: 2, viewer: 1 };
const INVITABLE: MemberRole[] = ['admin', 'editor', 'analyst', 'viewer'];

/** `lang`: the email's language, chosen by the inviter — we know nothing of the invitee yet. */
export type InviteInput = { email: string; role: MemberRole; lang?: Lang };

/** P8: the names of this store's members among `userIds` — someone who left the store is not named. */
export async function memberNames(ctx: TenantContext, userIds: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!userIds.length) return out;
  const members = await ctx.db.find(tenantMemberships, inArray(tenantMemberships.userId, userIds), { limit: userIds.length });
  if (!members.length) return out;
  const people = await unsafeAdminDb().select({ id: users.id, email: users.email, fullName: users.fullName })
    .from(users).where(inArray(users.id, members.map((m) => m.userId)));
  for (const person of people) out.set(person.id, person.fullName || person.email);
  return out;
}

export async function listTeam(ctx: TenantContext): Promise<TeamMemberRow[]> {
  ctx.require('team:read');
  const members = await ctx.db.find(tenantMemberships, undefined, { limit: 500 });
  // Users are platform accounts, not tenant rows: read the names of this store's members only.
  const people = members.length
    ? await unsafeAdminDb().select({ id: users.id, email: users.email, fullName: users.fullName, lastLoginAt: users.lastLoginAt })
      .from(users).where(inArray(users.id, members.map((m) => m.userId)))
    : [];
  const open = await ctx.db.find(invitations, and(isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())), { limit: 500 });
  const roleIds = [...new Set(members.map((m) => m.customRoleId).filter((id): id is string => !!id))];
  const roles = roleIds.length ? await ctx.db.find(customRoles, inArray(customRoles.id, roleIds), { limit: roleIds.length }) : [];
  const rows: TeamMemberRow[] = members.map((m) => {
    const person = people.find((p) => p.id === m.userId);
    const custom = m.customRoleId ? roles.find((r) => r.id === m.customRoleId) : undefined;
    return {
      id: m.id, fullName: person?.fullName ?? '', email: person?.email ?? '', role: m.role, status: m.status,
      lastLoginAt: person?.lastLoginAt?.toISOString() ?? null, customRole: custom ? { id: custom.id, name: custom.name } : null,
    };
  });
  for (const invite of open) {
    rows.push({ id: invite.id, fullName: '', email: invite.email, role: invite.role, status: 'invited', lastLoginAt: null });
  }
  return rows.sort((a, b) => RANK[b.role] - RANK[a.role] || a.email.localeCompare(b.email));
}

/**
 * Invite `email` as `role` and email them the link. Inviting an address that already has an
 * open invitation sends a fresh link and replaces the old one (the old link stops working).
 * Returns the raw token for the caller to build the link — it is not stored anywhere.
 */
export async function invite(ctx: TenantContext, input: InviteInput, config: { authSecret: string; appUrl: string }): Promise<{ id: string; token: string }> {
  ctx.require('team:invite');
  const email = normaliseEmail(input.email ?? '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw errors.validation({ email: ['is not an email address'] });
  if (!INVITABLE.includes(input.role)) throw errors.validation({ role: ['cannot be given by invitation'] });
  assertCanGrant(ctx, input.role);

  const [existing] = await unsafeAdminDb().select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing && await ctx.db.exists(tenantMemberships, eq(tenantMemberships.userId, existing.id))) {
    throw errors.conflict('this person is already on the team');
  }
  const limit = await rateLimiter().hit(`invite:${ctx.tenantId}`, LIMITS.invite.limit, LIMITS.invite.windowSeconds); // P7
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfter);

  const token = secret(32);
  const tokenHash = await keyedHash(config.authSecret, 'invitation', token);
  const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
  // Read before the transaction: the plan lives on the platform (admin) handle, which must
  // not be used inside a tenant transaction (one connection in tests — see STATE.md).
  const seats = (await entitlementsOf(ctx)).limit('team_members');
  const id = await withTenant(ctx.tenantId, async (db) => {
    const open = await db.findOne(invitations, and(eq(invitations.email, email), isNull(invitations.acceptedAt)));
    if (open) {
      await db.updateById(invitations, open.id, { role: input.role, tokenHash, expiresAt, invitedBy: ctx.actor.userId });
      await record(ctx, { action: 'invite', resourceType: 'invitation', resourceId: open.id, after: { email, role: input.role, resent: true } }, db);
      return open.id;
    }
    await assertSeat(db, seats);
    const created = await db.insert(invitations, { id: uuidv7(), tenantId: ctx.tenantId, email, role: input.role, tokenHash, expiresAt, invitedBy: ctx.actor.userId });
    await record(ctx, { action: 'invite', resourceType: 'invitation', resourceId: created.id, after: { email, role: input.role } }, db);
    return created.id;
  });

  await sendEmail(email, EMAIL.teamInvite, {
    link: `${config.appUrl}/invite/${token}`, store: ctx.tenant.name, days: INVITE_DAYS,
  }, input.lang === 'en' ? 'en' : 'ar');
  return { id, token };
}

export async function revokeInvitation(ctx: TenantContext, invitationId: string): Promise<void> {
  ctx.require('team:invite');
  const invitation = await ctx.db.findById(invitations, invitationId);
  if (!invitation || invitation.acceptedAt) throw errors.notFound('invitation');
  await auditedDelete(ctx, invitations, invitationId, { resourceType: 'invitation' });
}

export async function changeRole(ctx: TenantContext, membershipId: string, role: MemberRole): Promise<void> {
  ctx.require('team:manage');
  const member = await ctx.db.findById(tenantMemberships, membershipId);
  if (!member) throw errors.notFound('team member');
  if (member.userId === ctx.actor.userId) throw errors.forbidden('you cannot change your own role');
  if (member.role === 'owner') throw errors.forbidden('the owner’s role cannot be changed here');
  if (!INVITABLE.includes(role)) throw errors.validation({ role: ['cannot be given here'] });
  assertCanGrant(ctx, role);
  assertCanGrant(ctx, member.role); // an admin cannot touch someone ranked above them
  if (member.role === role && !member.customRoleId) return;
  // A built-in role replaces a custom one (P8).
  await auditedUpdate(ctx, tenantMemberships, membershipId, { role, customRoleId: null }, { resourceType: 'team_member', action: 'role_change' });
}

// ------------------------------------------------------------------ P8: custom roles (Enterprise)

function roleInput(input: { name?: string; permissions?: string[] }): { name?: string; permissions?: string[] } {
  const fields: Record<string, string[]> = {};
  const out: { name?: string; permissions?: string[] } = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2 || name.length > 60) fields.name = ['a name of 2 to 60 characters'];
    else if ((MEMBER_ROLE as readonly string[]).includes(name.toLowerCase())) fields.name = ['that is the name of a built-in role'];
    out.name = name;
  }
  if (input.permissions !== undefined) {
    const allowed = CUSTOM_ROLE_PERMISSIONS as readonly string[];
    const chosen = [...new Set(input.permissions)];
    if (!chosen.length) fields.permissions = ['at least one'];
    else if (chosen.some((p) => !allowed.includes(p))) fields.permissions = ['a custom role cannot hold that: people, settings, billing, keys and connections stay with owners and admins'];
    out.permissions = allowed.filter((p) => chosen.includes(p));
  }
  if (Object.keys(fields).length) throw errors.validation(fields);
  return out;
}

async function roleOf(ctx: TenantContext, id: string) {
  const role = await ctx.db.findById(customRoles, id);
  if (!role) throw errors.notFound('custom role');
  return role;
}

export async function listCustomRoles(ctx: TenantContext): Promise<CustomRoleView[]> {
  ctx.require('team:read');
  const roles = await ctx.db.find(customRoles, undefined, { limit: MAX_CUSTOM_ROLES * 2, orderBy: asc(customRoles.id) });
  const holders = await ctx.db.find(tenantMemberships, isNotNull(tenantMemberships.customRoleId), { limit: 500 });
  return roles.map((r) => ({ id: r.id, name: r.name, permissions: r.permissions, members: holders.filter((m) => m.customRoleId === r.id).length }));
}

export async function createCustomRole(ctx: TenantContext, input: { name: string; permissions: string[] }): Promise<CustomRoleView> {
  ctx.require('team:manage');
  assertFeature(await entitlementsOf(ctx), 'custom_roles');
  const values = roleInput(input);
  const existing = await ctx.db.find(customRoles, undefined, { limit: MAX_CUSTOM_ROLES * 2 });
  if (existing.length >= MAX_CUSTOM_ROLES) throw errors.conflict(`a store keeps at most ${MAX_CUSTOM_ROLES} custom roles`);
  if (existing.some((r) => r.name.toLowerCase() === values.name!.toLowerCase())) throw errors.validation({ name: ['a role with this name exists'] });
  const row = await auditedInsert(ctx, customRoles, { id: uuidv7(), tenantId: ctx.tenantId, ...values, createdBy: ctx.actor.userId }, { resourceType: 'custom_role' }) as typeof customRoles.$inferSelect;
  return { id: row.id, name: row.name, permissions: row.permissions, members: 0 };
}

/** Change a role's name or permissions; its members have the new permissions from their next request. */
export async function updateCustomRole(ctx: TenantContext, id: string, input: { name?: string; permissions?: string[] }): Promise<CustomRoleView> {
  ctx.require('team:manage');
  assertFeature(await entitlementsOf(ctx), 'custom_roles');
  await roleOf(ctx, id);
  const values = roleInput(input);
  if (values.name) {
    const clash = (await ctx.db.find(customRoles, undefined, { limit: MAX_CUSTOM_ROLES * 2 })).some((r) => r.id !== id && r.name.toLowerCase() === values.name!.toLowerCase());
    if (clash) throw errors.validation({ name: ['a role with this name exists'] });
  }
  await auditedUpdate(ctx, customRoles, id, values, { resourceType: 'custom_role' });
  return (await listCustomRoles(ctx)).find((r) => r.id === id)!;
}

/** Delete a role nobody holds. One still held is a 409 naming how many: give them another role first. */
export async function deleteCustomRole(ctx: TenantContext, id: string): Promise<void> {
  ctx.require('team:manage');
  await roleOf(ctx, id);
  const holders = await ctx.db.count(tenantMemberships, eq(tenantMemberships.customRoleId, id));
  if (holders) throw errors.conflict(`${holders} member${holders === 1 ? ' still holds' : 's still hold'} this role: give them another role first`);
  await auditedDelete(ctx, customRoles, id, { resourceType: 'custom_role' });
}

/**
 * Give a member a custom role (or `null` to leave it at viewer). Not the owner, not yourself, not
 * someone ranked above you. Their built-in role becomes viewer underneath: if the store leaves the
 * plan, they fall back to the least.
 */
export async function assignCustomRole(ctx: TenantContext, membershipId: string, customRoleId: string | null): Promise<void> {
  ctx.require('team:manage');
  if (customRoleId) assertFeature(await entitlementsOf(ctx), 'custom_roles');
  const member = await ctx.db.findById(tenantMemberships, membershipId);
  if (!member) throw errors.notFound('team member');
  if (member.userId === ctx.actor.userId) throw errors.forbidden('you cannot change your own role');
  if (member.role === 'owner') throw errors.forbidden('the owner’s role cannot be changed here');
  assertCanGrant(ctx, member.role);
  if (customRoleId) await roleOf(ctx, customRoleId); // this store's role, or 404
  if (member.customRoleId === customRoleId && member.role === 'viewer') return;
  await auditedUpdate(ctx, tenantMemberships, membershipId, { customRoleId, role: 'viewer' }, { resourceType: 'team_member', action: 'role_change' });
}

export async function removeMember(ctx: TenantContext, membershipId: string): Promise<void> {
  ctx.require('team:manage');
  const member = await ctx.db.findById(tenantMemberships, membershipId);
  if (!member) throw errors.notFound('team member');
  if (member.userId === ctx.actor.userId) throw errors.forbidden('you cannot remove yourself');
  if (member.role === 'owner') throw errors.forbidden('the owner cannot be removed');
  assertCanGrant(ctx, member.role);
  await auditedDelete(ctx, tenantMemberships, membershipId, { resourceType: 'team_member' });
}

/**
 * Accept an invitation as the signed-in `userId`. The account's email must be the invited
 * one. Wrong, expired, used and someone-else's are one answer, so a link cannot be probed.
 * Returns the store joined, for the caller to switch the session to it.
 */
export async function acceptInvitation(input: { token: string; userId: string; authSecret: string }): Promise<{ tenantId: string }> {
  const db = unsafeAdminDb(); // the invitee is not a member yet: there is no tenant scope to act in
  const invitation = await openInvitation(input.token, input.authSecret);
  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!invitation || !user || normaliseEmail(user.email) !== invitation.email) {
    throw errors.notFound('invitation');
  }
  await joinTeam(invitation, user);
  return { tenantId: invitation.tenantId };
}

type Invitation = typeof invitations.$inferSelect;

/** An open invitation (not used, not expired, its store not deleted) for `token`, or null. */
export async function openInvitation(token: string, authSecret: string): Promise<Invitation | null> {
  const db = unsafeAdminDb();
  const tokenHash = await keyedHash(authSecret, 'invitation', token ?? '');
  const [invitation] = await db.select().from(invitations)
    .where(and(eq(invitations.tokenHash, tokenHash), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
    .limit(1);
  if (!invitation) return null;
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, invitation.tenantId)).limit(1);
  return tenant && !tenant.deletedAt ? invitation : null;
}

/** The invitee joins in the invited role; the invitation is used up; the inviter is told. */
export async function joinTeam(invitation: Invitation, user: { id: string; email: string }): Promise<void> {
  await withTenant(invitation.tenantId, async (tdb) => {
    // Re-checked under the transaction: two clicks on one link make one membership.
    const still = await tdb.lockById(invitations, invitation.id);
    if (still.acceptedAt) throw errors.notFound('invitation');
    const already = await tdb.findOne(tenantMemberships, eq(tenantMemberships.userId, user.id));
    const membership = already ?? await tdb.insert(tenantMemberships, {
      id: uuidv7(), tenantId: invitation.tenantId, userId: user.id, role: invitation.role, status: 'active', invitedBy: invitation.invitedBy,
    });
    await tdb.updateById(invitations, invitation.id, { acceptedAt: new Date() });
    const ctx = {
      tenantId: invitation.tenantId, actor: { userId: user.id }, requestId: `invite-${invitation.id}`,
    } as unknown as TenantContext;
    await record(ctx, { action: 'create', resourceType: 'team_member', resourceId: membership.id, after: { email: user.email, role: membership.role, via: 'invitation' } }, tdb);
    await notifyIn(tdb, {
      type: 'team.joined', userIds: [invitation.invitedBy], level: 'success', href: '/dashboard/team',
      title: { ar: `انضم ${user.email} إلى الفريق`, en: `${user.email} joined the team` }, body: null,
    });
  });
}

function assertCanGrant(ctx: TenantContext, role: MemberRole): void {
  const mine = ctx.role === 'system' ? 0 : RANK[ctx.role];
  if (RANK[role] > mine || (role === 'admin' && mine < RANK.admin)) {
    throw errors.forbidden('you cannot give a role above your own');
  }
}

/** Members plus open invitations must stay within the plan's seats. */
async function assertSeat(db: TenantDb, limit: number): Promise<void> {
  if (limit === UNLIMITED) return;
  const members = await db.count(tenantMemberships, eq(tenantMemberships.status, 'active'));
  const pending = await db.count(invitations, and(isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())));
  if (members + pending + 1 > limit) throw errors.quota('team_members', limit);
}
