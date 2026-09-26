'use client';

/**
 * A12 — one trail row, wherever it is shown (a request's story, a store's activity): when, who
 * (and whether it was staff or the system), what, on which record, which fields changed — never
 * their values — and the request it came from, which opens that request's whole story.
 */
import { AppLink } from '@/lib/app-env';
import type { AdminTrailEntry } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { Badge } from '@/components/dashboard/ui';

export function TrailTable({ entries, showStore }: { entries: AdminTrailEntry[]; showStore?: boolean }) {
  const { t, lang } = useLang();
  return (
    <div className="table-wrap"><table className="data">
      <thead><tr>
        <th scope="col">{t('الوقت', 'When')}</th>
        <th scope="col">{t('من', 'Who')}</th>
        {showStore && <th scope="col">{t('المتجر', 'Store')}</th>}
        <th scope="col">{t('ماذا', 'What')}</th>
        <th scope="col">{t('الحقول', 'Fields')}</th>
        <th scope="col">{t('الطلب', 'Request')}</th>
      </tr></thead>
      <tbody>
        {entries.map((e) => (
          <tr key={`${e.source}:${e.id}`}>
            <td>{formatDateTime(e.at, lang)}</td>
            <td>
              <span dir="ltr">{e.actor ?? '—'}</span>
              {e.actorType !== 'user' && <> <Badge tone={e.actorType === 'staff' ? 'warn' : 'neutral'}>{e.actorType === 'staff' ? t('موظف', 'Staff') : e.actorType === 'system' ? t('النظام', 'System') : e.actorType}</Badge></>}
            </td>
            {showStore && <td>{e.store ? <AppLink href={`/admin/stores/${e.store.id}`}>{lang === 'ar' ? e.store.nameAr ?? e.store.name : e.store.name}</AppLink> : '—'}</td>}
            <td className="cell-main">
              <span className="mm" dir="ltr">{e.resourceType} · {e.action}</span>
              {(e.reason || e.resourceId) && <span className="lines">{e.reason ?? <span dir="ltr">{e.resourceId}</span>}</span>}
            </td>
            <td className="mm" dir="ltr">{e.fields.length ? e.fields.join(', ') : '—'}</td>
            <td className="mm" dir="ltr">{e.requestId ? <AppLink href={`/admin/support?q=${encodeURIComponent(e.requestId)}`}>{e.requestId.slice(-8)}</AppLink> : '—'}</td>
          </tr>
        ))}
      </tbody>
    </table></div>
  );
}
