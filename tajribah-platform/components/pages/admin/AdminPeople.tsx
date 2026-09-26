'use client';

// ADM-11 — Users: find anyone by email, name or id (A5)

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useAuth, type AdminPersonRow } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { AdminShell } from '@/components/admin/shell';
import { Badge, Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

export default function AdminPeople() {
  const { t } = useLang();
  return <AdminShell title={t('الأشخاص', 'People')}><List /></AdminShell>;
}

function List() {
  const { t, lang } = useLang();
  const auth = useAuth();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState('');
  const [pages, setPages] = useState<{ key: string; rows: AdminPersonRow[]; next: string | null } | null>(null);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setQuery(q.trim()), 250);
    return () => clearTimeout(timer);
  }, [q]);

  useEffect(() => {
    let live = true;
    auth.admin.people({ q: query }).then((page) => { if (live) setPages({ key: query, rows: page.people, next: page.next }); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, query]);

  const more = async () => {
    if (!pages?.next) return;
    const page = await auth.admin.people({ q: query, before: pages.next });
    setPages({ key: query, rows: [...pages.rows, ...page.people], next: page.next });
  };

  const current = pages?.key === query ? pages : null;
  return (
    <Panel flush title={t('كل الأشخاص', 'Everyone')} sub={t('الأحدث أولًا — أصحاب المتاجر وفرقهم والموظفون', 'Newest first — store owners, their teams, and staff')}>
      <div className="admin-filters">
        <label className="search">
          <Search size={15} aria-hidden />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('البريد أو الاسم أو المعرّف', 'Email, name or id')} aria-label={t('بحث', 'Search')} />
        </label>
      </div>
      {error && <ErrorNote error={error} />}
      {!current && !error && <Loading rows={4} />}
      {current && current.rows.length === 0 && <Empty title={t('لا أحد مطابق', 'Nobody matches')} body={t('غيّر البحث.', 'Change the search.')} />}
      {current && current.rows.length > 0 && (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">{t('الشخص', 'Person')}</th>
                <th scope="col">{t('المتاجر', 'Stores')}</th>
                <th scope="col">{t('الأمان', 'Security')}</th>
                <th scope="col">{t('آخر دخول', 'Last sign-in')}</th>
              </tr>
            </thead>
            <tbody>
              {current.rows.map((p) => (
                <tr key={p.id}>
                  <td className="cell-main">
                    <AppLink href={`/admin/people/${p.id}`}>{p.fullName || p.email}</AppLink>
                    <span className="lines"><span dir="ltr">{p.email}</span></span>
                  </td>
                  <td className="num">{p.stores}</td>
                  <td>
                    <Badge tone={p.twoFactor ? 'ok' : 'neutral'}>{p.twoFactor ? t('بخطوتين', 'Two-step') : t('كلمة مرور فقط', 'Password only')}</Badge>
                    {p.isStaff && <> <Badge tone="accent">{t('موظف', 'Staff')}</Badge></>}
                    {!p.emailVerified && <> <Badge tone="warn">{t('بريد غير مؤكد', 'Email not verified')}</Badge></>}
                  </td>
                  <td>{p.lastLoginAt ? formatDate(p.lastLoginAt, lang) : '—'}</td>
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
