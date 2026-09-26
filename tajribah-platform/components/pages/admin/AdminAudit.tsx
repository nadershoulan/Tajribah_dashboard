'use client';

// ADM-43 — Global audit log (A1: the staff trail)

import { useEffect, useState } from 'react';
import { useAuth, type StaffTrailRow } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { AdminShell } from '@/components/admin/shell';
import { Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

/** A uuid is shortened to its first 8 characters (full on hover); a code like WELCOME20 is shown whole. */
const shortId = (id: string) => (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(id) ? id.slice(0, 8) : id);

export default function AdminAudit() {
  const { t } = useLang();
  return (
    <AdminShell title={t('سجل الموظفين', 'Staff activity')}>
      <Trail />
    </AdminShell>
  );
}

function Trail() {
  const { t, lang } = useLang();
  const auth = useAuth();
  const [rows, setRows] = useState<StaffTrailRow[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let live = true;
    auth.admin.trail().then((r) => { if (live) setRows(r); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin]);

  if (error) return <ErrorNote error={error} />;
  if (!rows) return <Panel><Loading rows={4} /></Panel>;
  return (
    <Panel flush title={t('آخر ما فعله الموظفون', 'What staff did, newest first')} sub={t('لا يُعدَّل ولا يُحذف من هنا.', 'Nothing here can be edited or removed.')}>
      {rows.length === 0 ? (
        <Empty title={t('لا شيء بعد', 'Nothing yet')} body={t('يظهر هنا كل إجراء يقوم به موظف: تمديد تجربة، تعديل رصيد، إيقاف متجر…', 'Every staff action shows here: a trial extended, credits adjusted, a store suspended…')} />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th scope="col">{t('الوقت', 'When')}</th>
                <th scope="col">{t('الموظف', 'Staff')}</th>
                <th scope="col">{t('الإجراء', 'Action')}</th>
                <th scope="col">{t('على', 'On')}</th>
                <th scope="col">{t('السبب', 'Reason')}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td>{formatDateTime(row.at, lang)}</td>
                  <td dir="ltr">{row.staff}</td>
                  <td className="mm" dir="ltr">{row.action}</td>
                  <td className="mm" dir="ltr" title={row.targetId ?? undefined}>{row.targetType}{row.targetId ? ` ${shortId(row.targetId)}` : ''}</td>
                  <td>{row.reason ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
