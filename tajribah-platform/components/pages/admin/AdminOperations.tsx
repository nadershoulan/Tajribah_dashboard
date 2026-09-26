'use client';

// A11 — Platform operations: queues, stuck and dead jobs, webhook failures, key rotation

import { useEffect, useState } from 'react';
import { useAuth, type AdminOperations } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { AdminShell } from '@/components/admin/shell';
import { Badge, Empty, ErrorNote, Loading, Panel, Stat } from '@/components/dashboard/ui';

export default function AdminOperationsPage() {
  const { t } = useLang();
  return <AdminShell title={t('تشغيل المنصة', 'Platform operations')}><Operations /></AdminShell>;
}

function lag(seconds: number | null, t: (ar: string, en: string) => string): string {
  if (seconds == null) return '—';
  if (seconds < 60) return t(`${seconds} ث`, `${seconds}s`);
  if (seconds < 3600) return t(`${Math.round(seconds / 60)} د`, `${Math.round(seconds / 60)} min`);
  return t(`${Math.round(seconds / 3600)} س`, `${Math.round(seconds / 3600)} h`);
}

function Operations() {
  const { t, lang } = useLang();
  const auth = useAuth();
  const [data, setData] = useState<AdminOperations | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    auth.admin.operations().then((d) => { if (live) setData(d); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, version]);
  const reload = () => setVersion((v) => v + 1);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Panel><Loading rows={6} /></Panel>;
  const store = (s: { name: string; nameAr: string | null } | null) => (s ? (lang === 'ar' ? s.nameAr ?? s.name : s.name) : t('المنصة', 'Platform'));
  const { keys, webhooks } = data;
  const pendingKeys = keys.pending.connectionTokens + keys.pending.authenticatorSecrets;

  return (
    <div className="ops">
      <p className="hint" style={{ margin: 0 }}>
        {t('حتى', 'As of')} {formatDateTime(data.asOf, lang)} · <button type="button" className="btn btn-ghost btn-sm" onClick={reload}>{t('تحديث', 'Refresh')}</button>
      </p>

      <Panel title={t('تدوير مفتاح التشفير', 'Encryption key rotation')} sub={t('المفتاح الحالي', 'Current key') + ` · ${keys.currentKeyId}`}>
        {!keys.previousKeySet && <p style={{ margin: 0 }}>{t('لا تدوير جارٍ: لا مفتاح سابق مضبوط.', 'No rotation in progress: no previous key is set.')}{pendingKeys > 0 && <> <Badge tone="bad">{t(`${pendingKeys} قيمة لا يفتحها المفتاح الحالي`, `${pendingKeys} values the current key cannot open`)}</Badge></>}</p>}
        {keys.previousKeySet && (keys.previousKeyRemovable
          ? <p style={{ margin: 0 }}><Badge tone="ok">{t('جاهز', 'Ready')}</Badge> {t('لا شيء يحتاج المفتاح السابق. احذف ENCRYPTION_KEY_PREVIOUS وأعد النشر.', 'Nothing needs the previous key. Remove ENCRYPTION_KEY_PREVIOUS and redeploy.')}</p>
          : <p style={{ margin: 0 }}><Badge tone="warn">{t('جارٍ', 'In progress')}</Badge> {t(`ما زال بالمفتاح السابق: ${keys.pending.connectionTokens} رمز ربط، ${keys.pending.authenticatorSecrets} سر مصادقة. تنقلها مهمة العامل كل دقيقة.`, `Still under the previous key: ${keys.pending.connectionTokens} connection tokens, ${keys.pending.authenticatorSecrets} authenticator secrets. The worker moves them every minute.`)}</p>)}
      </Panel>

      <Panel flush title={t('الطوابير', 'Queues')} sub={t('التأخر: كم انتظرت أقدم مهمة جاهزة', 'Lag: how long the oldest ready job has waited')}>
        {data.queues.length === 0 ? <Empty title={t('لا مهام', 'No jobs')} body={t('لا شيء في الطوابير.', 'Nothing is queued.')} /> : (
          <div className="table-wrap"><table className="data">
            <thead><tr>
              <th scope="col">{t('الطابور', 'Queue')}</th><th scope="col" className="num">{t('جاهزة', 'Ready')}</th><th scope="col" className="num">{t('مؤجلة', 'Scheduled')}</th>
              <th scope="col" className="num">{t('قيد التنفيذ', 'Running')}</th><th scope="col" className="num">{t('ميتة', 'Dead')}</th><th scope="col" className="num">{t('أُنجزت (24 س)', 'Done (24h)')}</th><th scope="col" className="num">{t('التأخر', 'Lag')}</th>
            </tr></thead>
            <tbody>
              {data.queues.map((q) => (
                <tr key={q.queue}>
                  <td className="mm" dir="ltr">{q.queue}</td><td className="num">{q.ready}</td><td className="num">{q.scheduled}</td><td className="num">{q.running}</td>
                  <td className="num">{q.dead ? <Badge tone="bad">{q.dead}</Badge> : 0}</td><td className="num">{q.doneLastDay}</td>
                  <td className="num">{q.lagSeconds != null && q.lagSeconds > 300 ? <Badge tone="warn">{lag(q.lagSeconds, t)}</Badge> : lag(q.lagSeconds, t)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Panel>

      {data.stuck.length > 0 && (
        <Panel flush title={t('مهام عالقة', 'Stuck jobs')} sub={t('حجزها عامل منذ أكثر من 5 دقائق — تعيدها المهمة الدورية تلقائيًا؛ بقاؤها يعني أنها لا تعمل.', 'Claimed by a worker over 5 minutes ago — the sweep hands them back on its own; if they stay, it is not running.')}>
          <div className="table-wrap"><table className="data"><tbody>
            {data.stuck.map((j) => <tr key={j.id}><td className="mm" dir="ltr">{j.queue}</td><td>{store(j.store)}</td><td dir="ltr">{j.claimedBy ?? '—'}</td><td>{j.claimedAt ? formatDateTime(j.claimedAt, lang) : '—'}</td></tr>)}
          </tbody></table></div>
        </Panel>
      )}

      <Panel flush title={t('مهام ميتة', 'Dead jobs')} sub={t('استنفدت محاولاتها وتنتظر شخصًا', 'Out of attempts, waiting for a person')}>
        {data.dead.length === 0 ? <Empty title={t('لا شيء', 'None')} body={t('لا مهمة ميتة.', 'No job has died.')} /> : (
          <ul className="ops-list">
            {data.dead.map((j) => (
              <li key={j.id}>
                <div className="ops-what"><span className="mm" dir="ltr">{j.queue}</span><span>{store(j.store)} · {j.finishedAt ? formatDateTime(j.finishedAt, lang) : '—'}</span></div>
                <p dir="ltr" className="ops-error">{j.lastError ?? '—'}</p>
                <Retry label={t('أعد المحاولة', 'Retry')} run={(reason) => auth.admin.retryJob(j.id, reason)} onDone={reload} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid grid-4">
        <Stat label={t('إشعارات مستلمة (24 س)', 'Webhooks received (24h)')} value={String(webhooks.lastDay.received + webhooks.lastDay.processed + webhooks.lastDay.failed + webhooks.lastDay.ignored)} />
        <Stat label={t('عولجت', 'Processed')} value={String(webhooks.lastDay.processed)} />
        <Stat label={t('فشلت', 'Failed')} value={String(webhooks.lastDay.failed)} />
        <Stat label={t('متأخرة', 'Overdue')} value={String(webhooks.overdue)} sub={t('تنتظر أكثر من 15 دقيقة بعد موعدها', 'Waiting 15+ minutes past due')} />
      </div>

      <Panel flush title={t('إشعارات فشلت', 'Failed webhook deliveries')} sub={t('استنفدت محاولاتها؛ الإعادة تعالجها كأول مرة', 'Out of attempts; a replay handles it like the first time')}>
        {webhooks.failed.length === 0 ? <Empty title={t('لا شيء', 'None')} body={t('لا إشعار فاشل.', 'No failed delivery.')} /> : (
          <ul className="ops-list">
            {webhooks.failed.map((w) => (
              <li key={w.id}>
                <div className="ops-what"><span className="mm" dir="ltr">{w.provider} · {w.topic}</span><span>{store(w.store)} · {formatDateTime(w.createdAt, lang)}</span></div>
                <p dir="ltr" className="ops-error">{w.error ?? '—'}</p>
                <Retry label={t('أعد المعالجة', 'Replay')} run={(reason) => auth.admin.replayWebhook(w.id, reason)} onDone={reload} />
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}

/** A retry needs a reason: the button opens a one-line form, then does it. */
function Retry({ label, run, onDone }: { label: string; run: (reason: string) => Promise<void>; onDone: () => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!open) return <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>{label}</button>;
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) return;
    setBusy(true); setProblem(null);
    try { await run(reason.trim()); onDone(); } catch (err) { setProblem((err as Error).message); setBusy(false); }
  };
  return (
    <form className="ops-retry" onSubmit={submit}>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('السبب', 'Reason')} aria-label={t('السبب', 'Reason')} maxLength={500} autoFocus />
      <button type="submit" className="btn btn-accent btn-sm" disabled={busy || reason.trim().length < 5}>{label}</button>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>{t('إلغاء', 'Cancel')}</button>
      {problem && <span className="field-error" role="alert" dir="ltr">{problem}</span>}
    </form>
  );
}
