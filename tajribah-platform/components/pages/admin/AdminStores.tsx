'use client';

// ADM-03 — Tenants: list with filters (A3)

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useAuth, type AdminStoreRow } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { PLANS, planByCode } from '@/lib/plans';
import { AdminShell } from '@/components/admin/shell';
import { Badge, Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

export const STATUS_LABEL: Record<AdminStoreRow['status'], { ar: string; en: string }> = {
  trial: { ar: 'تجربة', en: 'Trial' }, active: { ar: 'نشط', en: 'Active' }, past_due: { ar: 'دفعة متأخرة', en: 'Past due' },
  suspended: { ar: 'موقوف', en: 'Suspended' }, cancelled: { ar: 'ملغى', en: 'Cancelled' },
};

export default function AdminStores() {
  const { t } = useLang();
  return <AdminShell title={t('المتاجر', 'Stores')}><List /></AdminShell>;
}

function List() {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState({ q: '', status: '', plan: '' });
  const [pages, setPages] = useState<{ key: string; rows: AdminStoreRow[]; next: string | null } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const key = JSON.stringify(query);

  useEffect(() => {
    const timer = setTimeout(() => setQuery((current) => (current.q === q.trim() ? current : { ...current, q: q.trim() })), 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    let live = true;
    auth.admin.stores(query).then((page) => { if (live) setPages({ key, rows: page.stores, next: page.next }); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, key, query]);

  const more = async () => {
    if (!pages?.next) return;
    const page = await auth.admin.stores({ ...query, before: pages.next });
    setPages({ key, rows: [...pages.rows, ...page.stores], next: page.next });
  };

  const current = pages?.key === key ? pages : null;
  return (
    <Panel flush title={t('كل المتاجر', 'Every store')} sub={t('الأحدث أولًا', 'Newest first')}>
      <div className="admin-filters">
        <label className="search">
          <Search size={15} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('الاسم أو العنوان أو المعرّف', 'Name, address or id')} aria-label={t('بحث', 'Search')} />
        </label>
        <select value={query.status} onChange={(e) => setQuery({ ...query, status: e.target.value })} aria-label={t('الحالة', 'Status')}>
          <option value="">{t('كل الحالات', 'Any status')}</option>
          {Object.entries(STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{pick(label)}</option>)}
        </select>
        <select value={query.plan} onChange={(e) => setQuery({ ...query, plan: e.target.value })} aria-label={t('الباقة', 'Plan')}>
          <option value="">{t('كل الباقات', 'Any plan')}</option>
          {PLANS.map((p) => <option key={p.code} value={p.code}>{pick(p.name)}</option>)}
        </select>
      </div>
      {error && <ErrorNote error={error} />}
      {!current && !error && <Loading rows={4} />}
      {current && current.rows.length === 0 && <Empty title={t('لا متاجر مطابقة', 'No matching stores')} body={t('غيّر البحث أو المرشحات.', 'Change the search or the filters.')} />}
      {current && current.rows.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">{t('المتجر', 'Store')}</th>
                <th scope="col">{t('الحالة', 'Status')}</th>
                <th scope="col">{t('الباقة', 'Plan')}</th>
                <th scope="col">{t('منذ', 'Since')}</th>
              </tr>
            </thead>
            <tbody>
              {current.rows.map((s) => (
                <tr key={s.id}>
                  <td className="cell-main">
                    <AppLink href={`/admin/stores/${s.id}`}>{lang === 'ar' ? s.nameAr ?? s.name : s.name}</AppLink>
                    <span className="lines"><span dir="ltr">{s.slug}</span></span>
                  </td>
                  <td>
                    <Badge tone={s.status === 'active' ? 'ok' : s.status === 'trial' ? 'accent' : 'bad'}>{pick(STATUS_LABEL[s.status])}</Badge>
                    {s.readOnly && <> <Badge tone="warn">{t('للاطلاع فقط', 'Read-only')}</Badge></>}
                  </td>
                  <td>{pick(planByCode(s.plan).name)}</td>
                  <td>{formatDate(s.createdAt, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {current?.next && <div className="btn-row" style={{ padding: 16 }}><button type="button" className="btn btn-ghost" onClick={more}>{t('المزيد', 'Show more')}</button></div>}
    </Panel>
  );
}
