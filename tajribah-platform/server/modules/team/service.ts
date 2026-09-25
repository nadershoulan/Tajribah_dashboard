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
import { and, eq, gt, inArray, isNull } from 'drizzle-orm';
import { unsafeAdminDb } from '@/db/client';
import { invitations, tenantMemberships, tenants, users } from '@/db/schema';
import { secret, uuidv7 } from '@/lib/ids';
import type { MemberRole } from '@/lib/permissions';
import type { TeamMemberRow } from '@/lib/view-models';
import { auditedDelete, auditedUpdate, record } from '@/server/core/audit/audit';
import { keyedHash } from '@/server/core/auth/crypto';
import { entitlementsOf } from '@/server/core/billing/entitlements';
import { errors } from '@/server/core/errors/problem';
import { EMAIL, sendEmail } from '@/server/core/notify/messages';
import type { TenantContext } from '@/server/core/tenancy/context';
import { withTenant } from '@/server/core/tenancy/rls';
import type { TenantDb } from '@/server/core/tenancy/tenant-db';
import { normaliseEmail } from '@/server/modules/auth/service';
import { UNLIMITED } from '@/lib/plans';

export const INVITE_DAYS = 7;
const RANK: Record<MemberRole, number> = { owner: 5, admin: 4, editor: 3, analyst: 2, viewer: 1 };
const INVITABLE: MemberRole[] = ['admin', 'editor', 'analyst', 'viewer'];

export type InviteInput = { email: string; role: MemberRole };

export async function listTeam(ctx: TenantContext): Promise<TeamMemberRow[]> {
  ctx.require('team:read');
  const members = await ctx.db.find(tenantMemberships, undefined, { limit: 500 });
  // Users are platform accounts, not tenant rows: read the names of this store's members only.
  const people = members.length
    ? await unsafeAdminDb().select({ id: users.id, email: users.email, fullName: users.fullName, lastLoginAt: users.lastLoginAt })
      .from(users).where(inArray(users.id, members.map((m) => m.userId)))
    : [];
  const open = await ctx.db.find(invitations, and(isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())), { limit: 500 });
  const rows: TeamMemberRow[] = members.map((m) => {
    const person = people.find((p) => p.id === m.userId);
    return {
      id: m.id, fullName: person?.fullName ?? '', email: person?.email ?? '', role: m.role, status: m.status,
      lastLoginAt: person?.lastLoginAt?.toISOString() ?? null,
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
  }, 'ar');
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
  if (member.role === role) return;
  await auditedUpdate(ctx, tenantMemberships, membershipId, { role }, { resourceType: 'team_member', action: 'role_change' });
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
  const tokenHash = await keyedHash(input.authSecret, 'invitation', input.token ?? '');
  const [invitation] = await db.select().from(invitations)
    .where(and(eq(invitations.tokenHash, tokenHash), isNull(invitations.acceptedAt), gt(invitations.expiresAt, new Date())))
    .limit(1);
  const [user] = await db.select().from(users).where(eq(users.id, input.userId)).limit(1);
  if (!invitation || !user || normaliseEmail(user.email) !== invitation.email) {
    throw errors.notFound('invitation');
  }
  const [tenant] = await db.select().from(tenants).where(eq(tenants.id, invitation.tenantId)).limit(1);
  if (!tenant || tenant.deletedAt) throw errors.notFound('invitation');

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
  });
  return { tenantId: invitation.tenantId };
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
