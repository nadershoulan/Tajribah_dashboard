'use client';

/**
 * T50 (filed under P2.11) — when this store cannot be changed, its screens say so on the buttons,
 * not only in a banner and a refusal after the click: a read-only store (trial or subscription
 * ended) and a staff view both lock every change. Billing stays open — choosing a plan is the way out.
 *
 * Read from the session, not from a provider in the Shell: many pages render the Shell themselves,
 * so their own buttons sit outside anything the Shell could provide. The server is still the guard
 * (402 / 403); this only stops offering what would be refused.
 */
import { currentStore } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useLang } from '@/lib/i18n';

export type WriteLock = { locked: boolean; title: string | undefined };

/** Why this session may change nothing in its store, or null. */
export function lockOf(me: Parameters<typeof currentStore>[0]): 'staff_view' | 'read_only' | null {
  if (me?.staffView) return 'staff_view';
  if (currentStore(me)?.readOnly) return 'read_only';
  return null;
}

/** `disabled={… || lock.locked}` and `title={lock.title}` on a button that changes the store. */
export function useWriteLock(): WriteLock {
  const { t } = useLang();
  const { me } = useAuth();
  const why = lockOf(me);
  if (why === 'staff_view') return { locked: true, title: t('عرض الموظفين للاطلاع فقط', 'A staff view only looks') };
  if (why === 'read_only') return { locked: true, title: t('المتجر للاطلاع فقط حتى تختار باقة', 'Read-only until you choose a plan') };
  return { locked: false, title: undefined };
}
