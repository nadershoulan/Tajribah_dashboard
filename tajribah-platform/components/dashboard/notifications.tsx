'use client';

/**
 * P1.23 — the bell: unread count, the latest notifications, mark read.
 *
 * Opening the panel loads the list; clicking one marks it read and goes where it points.
 * The panel closes on Escape and on a click outside it, and returns focus to the bell.
 */
import { useEffect, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { useEnv } from '@/lib/app-env';
import { useData, useResource } from '@/lib/data';
import { formatRelative } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import type { NotificationItem } from '@/lib/view-models';

export function NotificationBell() {
  const { t, pick, lang } = useLang();
  const env = useEnv();
  const source = useData();
  const [open, setOpen] = useState(false);
  const [version, setVersion] = useState(0);
  const { data } = useResource((s) => s.notifications(), [version]);
  const box = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus(); } };
    const onClick = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => { document.removeEventListener('keydown', onKey); document.removeEventListener('mousedown', onClick); };
  }, [open]);

  const unread = data?.unread ?? 0;
  const go = async (item: NotificationItem) => {
    if (!item.read) await source.markNotificationsRead([item.id]).catch(() => undefined);
    setOpen(false);
    setVersion((v) => v + 1);
    if (item.href) env.navigate(item.href);
  };
  const markAll = async () => {
    await source.markNotificationsRead('all').catch(() => undefined);
    setVersion((v) => v + 1);
  };

  return (
    <div className="bell" ref={box}>
      <button ref={button} type="button" className="icon-btn" aria-expanded={open} aria-haspopup="true"
        aria-label={unread ? t(`الإشعارات، ${unread} غير مقروءة`, `Notifications, ${unread} unread`) : t('الإشعارات', 'Notifications')}
        onClick={() => { setOpen((v) => !v); if (!open) setVersion((v) => v + 1); }}>
        <Bell size={17} />
        {unread > 0 && <span className="bell-count" aria-hidden>{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div className="bell-panel" role="region" aria-label={t('الإشعارات', 'Notifications')}>
          <div className="bell-head">
            <strong>{t('الإشعارات', 'Notifications')}</strong>
            {unread > 0 && <button type="button" className="btn btn-quiet btn-sm" onClick={markAll}>{t('تحديد الكل كمقروء', 'Mark all read')}</button>}
          </div>
          {!data?.items.length && <p className="bell-empty">{t('لا شيء جديد.', 'Nothing new.')}</p>}
          <ul>
            {data?.items.map((item) => (
              <li key={item.id}>
                <button type="button" className={`bell-item level-${item.level}${item.read ? '' : ' is-unread'}`} onClick={() => go(item)}>
                  <span className="bell-title">{pick(item.title)}</span>
                  {item.body && <span className="bell-body">{pick(item.body)}</span>}
                  <span className="bell-time">{formatRelative(item.createdAt, lang)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
