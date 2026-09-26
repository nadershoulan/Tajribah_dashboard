'use client';

// A14 — Compliance: privacy requests (PDPL) and retention, under T22

import { useEffect, useState } from 'react';
import { AppLink } from '@/lib/app-env';
import { useAuth, type AdminPrivacyRequest, type AdminRetention } from '@/lib/auth';
import { formatDate, formatNumber } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { AdminShell } from '@/components/admin/shell';
import { Badge, Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

export default function AdminCompliance() {
  const { t } = useLang();
  const [tab, setTab] = useState<'privacy' | 'retention'>('privacy');
  return (
    <AdminShell title={t('الامتثال', 'Compliance')}>
      <div className="seg" role="tablist" aria-label={t('العرض', 'View')} style={{ marginBottom: 16 }}>
        <button type="button" role="tab" aria-selected={tab === 'privacy'} className={tab === 'privacy' ? 'on' : ''} onClick={() => setTab('privacy')}>{t('طلبات البيانات', 'Privacy requests')}</button>
        <button type="button" role="tab" aria-selected={tab === 'retention'} className={tab === 'retention' ? 'on' : ''} onClick={() => setTab('retention')}>{t('مدد الاحتفاظ', 'Retention')}</button>
      </div>
      {tab === 'privacy' ? <Privacy /> : <Retention />}
      <p className="hint" style={{ marginTop: 16 }}>{t('كل خطوة هنا في ', 'Every step here is in the ')}<AppLink href="/admin/audit">{t('سجل الموظفين', 'staff activity')}</AppLink>{t('. القواعد: القرار T22.', '. Rules: decision T22.')}</p>
    </AdminShell>
  );
}

const STATUS: Record<AdminPrivacyRequest['status'], { ar: string; en: string; tone: 'accent' | 'warn' | 'ok' | 'neutral' }> = {
  received: { ar: 'مستلم', en: 'Received', tone: 'accent' }, processing: { ar: 'قيد المعالجة', en: 'In progress', tone: 'warn' },
  completed: { ar: 'مكتمل', en: 'Done', tone: 'ok' }, rejected: { ar: 'مغلق دون إجراء', en: 'Closed', tone: 'neutral' },
};

function Privacy() {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  const [data, setData] = useState<{ requests: AdminPrivacyRequest[]; responseDays: number } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    auth.admin.privacyRequests().then((d) => { if (live) setData(d); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, version]);
  const reload = () => setVersion((v) => v + 1);
  const run = async (id: string, fn: () => Promise<unknown>) => {
    setBusy(id); setProblem(null);
    try { await fn(); reload(); } catch (e) { setProblem((e as Error).message); } finally { setBusy(null); }
  };
  const download = async (id: string) => {
    const doc = await auth.admin.privacyExport(id);
    const url = URL.createObjectURL(new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url; a.download = `tajribah-data-export-${id}.json`; a.click();
    URL.revokeObjectURL(url);
  };

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Panel><Loading rows={4} /></Panel>;
  return (
    <div className="ops">
      <RecordForm responseDays={data.responseDays} onSaved={reload} />
      {problem && <p className="field-error" role="alert" style={{ margin: 0 }}>{t('لم يُنفَّذ: ', 'Not done: ')}<span dir="ltr">{problem}</span></p>}
      <Panel flush title={t('السجل', 'Register')} sub={t('المفتوحة أولًا، الأقرب موعدًا أولًا', 'Open first, soonest due first')}>
        {data.requests.length === 0 ? <Empty title={t('لا طلبات', 'No requests')} body={t('لم يُسجَّل أي طلب بعد.', 'No request has been recorded yet.')} /> : (
          <ul className="ops-list">
            {data.requests.map((r) => {
              const open = r.status === 'received' || r.status === 'processing';
              return (
                <li key={r.id}>
                  <div className="ops-what">
                    <span>{r.type === 'export' ? t('نسخة من البيانات', 'Copy of data') : t('حذف الحساب', 'Erase the account')} · <span dir="ltr">{r.subjectEmail ?? t('(محذوف)', '(erased)')}</span>{!r.subjectUserId && r.subjectEmail && <> <Badge>{t('لا حساب', 'No account')}</Badge></>}</span>
                    <span>{t('استُلم', 'Received')} {formatDate(r.receivedAt, lang)}{r.dueAt ? ` · ${t('الموعد', 'due')} ${formatDate(r.dueAt, lang)}` : ''}{r.identityCheck ? ` · ${r.identityCheck}` : ''}</span>
                  </div>
                  <div>
                    <Badge tone={STATUS[r.status].tone}>{pick(STATUS[r.status])}</Badge>
                    {r.overdue && <> <Badge tone="bad">{t('متأخر', 'Overdue')}</Badge></>}
                    {r.note && <p className="hint" style={{ margin: '4px 0 0' }}>{r.note}</p>}
                  </div>
                  <div className="btn-row" style={{ margin: 0 }}>
                    {open && r.type === 'export' && r.subjectUserId && <button type="button" className="btn btn-accent btn-sm" disabled={busy === r.id} onClick={() => run(r.id, () => auth.admin.fulfilExport(r.id))}>{t('جهّز النسخة', 'Prepare export')}</button>}
                    {r.hasExport && <button type="button" className="btn btn-ghost btn-sm" onClick={() => download(r.id)}>{t('تنزيل', 'Download')}</button>}
                    {open && r.type === 'erase' && r.subjectUserId && (
                      <button type="button" className="btn btn-danger btn-sm" disabled={busy === r.id}
                        onClick={() => { if (window.confirm(t('سيُجهَّل الحساب نهائيًا. متابعة؟', 'The account will be anonymised for good. Continue?'))) void run(r.id, () => auth.admin.fulfilErasure(r.id)); }}>
                        {t('احذف الحساب', 'Erase')}
                      </button>
                    )}
                    {open && <CloseWithReason onClose={(reason) => run(r.id, () => auth.admin.rejectPrivacy(r.id, reason))} noAccount={!r.subjectUserId} />}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>
    </div>
  );
}

function CloseWithReason({ onClose, noAccount }: { onClose: (reason: string) => Promise<void>; noAccount: boolean }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState(noAccount ? t('لا نحتفظ ببيانات شخصية لهذا البريد — العملاء غير معرَّفين لدينا؛ يُرجى التواصل مع المتجر.', 'No personal data held for this address — shoppers are not identified; please ask the store.') : '');
  if (!open) return <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>{t('إغلاق دون إجراء', 'Close without action')}</button>;
  return (
    <form className="ops-retry" onSubmit={(e) => { e.preventDefault(); if (reason.trim().length >= 5) void onClose(reason.trim()); }}>
      <input value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('السبب المرسل للشخص', 'Reason given to the person')} maxLength={500} style={{ width: 260 }} />
      <button type="submit" className="btn btn-accent btn-sm" disabled={reason.trim().length < 5}>{t('أغلق', 'Close')}</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>{t('إلغاء', 'Cancel')}</button>
    </form>
  );
}

function RecordForm({ responseDays, onSaved }: { responseDays: number; onSaved: () => void }) {
  const { t } = useLang();
  const auth = useAuth();
  const [type, setType] = useState<'export' | 'erase'>('export');
  const [email, setEmail] = useState('');
  const [check, setCheck] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const ready = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) && check.trim().length >= 5;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setProblem(null);
    try { await auth.admin.recordPrivacy({ type, subjectEmail: email.trim(), identityCheck: check.trim() }); setEmail(''); setCheck(''); onSaved(); }
    catch (err) { setProblem((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Panel title={t('تسجيل طلب', 'Record a request')} sub={t(`يُرد خلال ${responseDays} يومًا من الاستلام.`, `Answered within ${responseDays} days of receipt.`)}>
      <form className="admin-actions" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="pr-type">{t('الطلب', 'Request')}</label>
          <select id="pr-type" value={type} onChange={(e) => setType(e.target.value as 'export' | 'erase')}>
            <option value="export">{t('نسخة من بياناته', 'A copy of their data')}</option>
            <option value="erase">{t('حذف حسابه', 'Erase their account')}</option>
          </select>
        </div>
        <div className="field act-email">
          <label htmlFor="pr-email">{t('بريد الشخص', 'Their email')}</label>
          <input id="pr-email" dir="ltr" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={254} />
        </div>
        <div className="field act-reason">
          <label htmlFor="pr-check">{t('كيف تحققت من هويته', 'How identity was checked')}</label>
          <input id="pr-check" value={check} onChange={(e) => setCheck(e.target.value)} maxLength={500} placeholder={t('مثال: راسلنا من بريد الحساب', 'e.g. wrote from the account email')} />
        </div>
        <div className="btn-row"><button type="submit" className="btn btn-primary" disabled={busy || !ready}>{t('سجّل', 'Record')}</button></div>
      </form>
      {problem && <p className="field-error" role="alert" style={{ margin: '8px 0 0' }}><span dir="ltr">{problem}</span></p>}
    </Panel>
  );
}

function Retention() {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  const [data, setData] = useState<AdminRetention | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let live = true;
    auth.admin.retention().then((d) => { if (live) setData(d); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin]);
  if (error) return <ErrorNote error={error} />;
  if (!data) return <Panel><Loading rows={5} /></Panel>;
  return (
    <div className="ops">
      <Panel flush title={t('ما يُحذف ومتى', 'What is removed, and when')} sub={t('يعمل الحذف تلقائيًا كل ساعة. العدد: ما سيحذفه التشغيل القادم.', 'The sweep runs every hour. The count is what its next run will remove.')}>
        <div className="table-wrap"><table className="data">
          <thead><tr><th scope="col">{t('البيانات', 'Data')}</th><th scope="col">{t('تُحفظ', 'Kept for')}</th><th scope="col" className="num">{t('مستحق الحذف', 'Due now')}</th></tr></thead>
          <tbody>
            {data.rules.map((r) => <tr key={r.key}><td>{pick(r.what)}</td><td>{pick(r.keep)}</td><td className="num">{formatNumber(r.due, lang)}</td></tr>)}
          </tbody>
        </table></div>
      </Panel>
      <Panel title={t('لا يُحذف تلقائيًا', 'Never removed by the sweep')}>
        <ul className="plain-list">
          {data.never.map((n) => <li key={n.what.en}><strong>{pick(n.what)}</strong> — {pick(n.why)}</li>)}
          <li><strong>{t('المتاجر المحذوفة', 'Deleted stores')}</strong> — {t(`تُعرض للمراجعة بعد 90 يومًا ولا تُمحى تلقائيًا (محوها يحذف فواتيرها). للمراجعة الآن: ${data.deletedStoresForReview}.`, `listed for review after 90 days, never purged automatically (purging would delete their invoices). For review now: ${data.deletedStoresForReview}.`)}</li>
        </ul>
      </Panel>
    </div>
  );
}
