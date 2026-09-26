/**
 * P2.11 — when a store may change things, as one rule used everywhere: the request context
 * (which refuses writes), entitlements (`canWrite`), the session (`/me`, for the banner).
 *
 * A store is **read-only** when its trial ended without a plan, or its subscription was
 * cancelled, expired or paused. `past_due` stays writable — dunning chases the payment, it
 * does not lock the store (P2.8). Read-only never deletes anything.
 *
 * Even read-only, a store can do what gets it out of that state: choose a plan and pay
 * (`billing:write`), keep the business details its invoices need (`settings:write`), and read
 * or export what it has.
 */
import type { Permission } from '@/lib/permissions';

export type ReadOnlyReason = 'trial_ended' | 'subscription_ended';

export type WriteState = { readOnly: ReadOnlyReason | null };

export function writeStateOf(input: {
  subscriptionStatus: 'trialing' | 'active' | 'past_due' | 'paused' | 'cancelled' | 'expired' | null;
  trialEndsAt: Date | null;
  now?: Date;
}): WriteState {
  const now = input.now ?? new Date();
  const trialOver = !!input.trialEndsAt && input.trialEndsAt.getTime() <= now.getTime();
  switch (input.subscriptionStatus) {
    case 'active':
    case 'past_due':
      return { readOnly: null };
    case 'paused':
    case 'cancelled':
    case 'expired':
      return { readOnly: 'subscription_ended' };
    case 'trialing':
    case null:
      return { readOnly: trialOver ? 'trial_ended' : null };
  }
}

/** What a read-only store may still do. Every other non-read permission is refused. */
const WHILE_READ_ONLY: ReadonlySet<Permission> = new Set<Permission>(['billing:write', 'settings:write', 'analytics:export']);

export function allowedWhileReadOnly(permission: Permission): boolean {
  return permission.endsWith(':read') || WHILE_READ_ONLY.has(permission);
}
