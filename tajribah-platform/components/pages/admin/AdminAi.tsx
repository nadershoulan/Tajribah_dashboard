'use client';

// A9 — AI operations: jobs by type, what the work cost us beside the credits charged, failures, quiet jobs
// P6.7 — and the guardrails: kinds of work paused, the platform's daily spend cap, each store's daily job cap

import { useEffect, useState, type FormEvent } from 'react';
import { Cpu } from 'lucide-react';
import { useAuth, type AdminAiGuardrails, type AdminAiJob, type AdminAiOperations } from '@/lib/auth';
import { formatDateTime, formatNumber, formatPercent } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { useLang } from '@/lib/i18n';
import { AdminShell } from '@/components/admin/shell';
import { Badge, Empty, ErrorNote, Loading, Panel, Stat } from '@/components/dashboard/ui';

export default function AdminAiPage() {
  const { t } = useLang();
  return <AdminShell title={t('عمليات الذكاء الاصطناعي', 'AI operations')}><Operations /></AdminShell>;
}

const TYPES: Record<string, { ar: string; en: string }> = {
  generate_3d: { ar: 'توليد نموذج', en: '3D generation' }, enhance_texture: { ar: 'تحسين الخامات', en: 'Texture enhancement' },
  embed_product: { ar: 'تمثيل المنتج', en: 'Product embedding' }, enrich_content: { ar: 'إثراء المحتوى', en: 'Content enrichment' },
  quality_check: { ar: 'فحص الجودة', en: 'Quality check' }, convert_format: { ar: 'تحويل الصيغة', en: 'Format conversion' },
};

function duration(seconds: number | null, t: (ar: string, en: string) => string): string {
  if (seconds == null) return '—';
  if (seconds < 60) return t(`${seconds} ث`, `${seconds}s`);
  if (seconds < 3600) return t(`${Math.round(seconds / 60)} د`, `${Math.round(seconds / 60)} min`);
  return t(`${(seconds / 3600).toFixed(1)} س`, `${(seconds / 3600).toFixed(1)} h`);
}

function Operations() {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  const [days, setDays] = useState<7 | 30 | 90>(30);
  const [data, setData] = useState<AdminAiOperations | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    auth.admin.aiOperations(days).then((d) => { if (live) setData(d); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, days, version]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Panel><Loading rows={6} /></Panel>;
  const usd = (cents: number) => formatMoney(cents, 'USD', lang);
  const store = (s: { name: string; nameAr: string | null }) => (lang === 'ar' ? s.nameAr ?? s.name : s.name);
  const type = (key: string) => (TYPES[key] ? pick(TYPES[key]!) : key);

  return (
    <div className="ops">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {([7, 30, 90] as const).map((d) => (
          <button key={d} type="button" className={`btn btn-sm ${days === d ? 'btn-primary' : 'btn-ghost'}`} onClick={() => { if (d !== days) { setData(null); setDays(d); } }}>
            {t(d === 7 ? 'آخر 7 أيام' : `آخر ${d} يومًا`, `Last ${d} days`)}
          </button>
        ))}
        <span className="hint" style={{ margin: 0 }}>{t('حتى', 'As of')} {formatDateTime(data.asOf, lang)}</span>
      </div>

      <div className="grid grid-3">
        <Stat label={t('مهام', 'Jobs')} value={formatNumber(data.totals.jobs, lang)} sub={data.totals.failureRate == null ? t('لا مهام منتهية بعد', 'None finished yet') : t(`${formatPercent(data.totals.failureRate, lang)} فشلت من المنتهية`, `${formatPercent(data.totals.failureRate, lang)} of finished ones failed`)} />
        <Stat label={t('ما دفعناه للمزوّدين', 'What providers charged us')} value={usd(data.totals.costCents)} sub={t(`${formatNumber(Math.round(data.totals.gpuSeconds / 60), lang)} دقيقة GPU`, `${formatNumber(Math.round(data.totals.gpuSeconds / 60), lang)} GPU minutes`)} />
        <Stat label={t('أرصدة خُصمت من التجار', 'Credits charged to merchants')} value={formatNumber(data.totals.creditsCharged, lang)}
          sub={t('بعد الاسترداد. الهامش يظهر حين يكون للرصيد سعر.', 'After refunds. The margin appears once a credit has a price.')} />
      </div>

      <Guardrails value={data.guardrails} type={type} onSaved={() => setVersion((v) => v + 1)} />

      <Panel title={t('حسب النوع', 'By type')} flush>
        {data.byType.length === 0
          ? <Empty icon={<Cpu size={22} />} title={t('لا مهام في هذه الفترة', 'No jobs in this period')} body={t('تظهر المهام هنا حين يبدأ التجار التوليد.', 'Jobs appear here once merchants start generating.')} />
          : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr>
                  <th scope="col">{t('النوع', 'Type')}</th><th scope="col">{t('الكل', 'All')}</th><th scope="col">{t('نجحت', 'Done')}</th>
                  <th scope="col">{t('فشلت', 'Failed')}</th><th scope="col">{t('أُلغيت', 'Cancelled')}</th><th scope="col">{t('جارية', 'Open')}</th>
                  <th scope="col">{t('المدة (الوسيط)', 'Median time')}</th><th scope="col">{t('التكلفة', 'Cost')}</th><th scope="col">{t('الأرصدة', 'Credits')}</th>
                </tr></thead>
                <tbody>
                  {data.byType.map((row) => (
                    <tr key={row.type}>
                      <td>{type(row.type)}</td>
                      <td className="num">{formatNumber(row.total, lang)}</td>
                      <td className="num">{formatNumber(row.done, lang)}</td>
                      <td className="num" style={{ color: row.failed ? 'var(--bad)' : undefined }}>{formatNumber(row.failed, lang)}</td>
                      <td className="num">{formatNumber(row.cancelled, lang)}</td>
                      <td className="num">{formatNumber(row.open, lang)}</td>
                      <td className="num">{duration(row.medianSeconds, t)}</td>
                      <td className="num" dir="ltr">{usd(row.costCents)}</td>
                      <td className="num">{formatNumber(row.creditsCharged, lang)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
      </Panel>

      <Panel flush title={t('صامتة لأكثر من 20 دقيقة', 'Quiet for over 20 minutes')} sub={t('قيد التنفيذ ولا خبر من المزوّد. تُفشَل تلقائيًا بعد ساعة.', 'Running, with no word from the provider. They are failed automatically after an hour.')}>
        {data.quiet.length === 0 ? <p className="hint" style={{ margin: 16 }}>{t('لا شيء.', 'None.')}</p> : (
          <ul className="ops-list">
            {data.quiet.map((job) => (
              <li key={job.id}>
                <JobLine job={job} type={type(job.type)} store={store(job.store)} />
                <span className="hint" style={{ margin: 0 }}>{t('آخر خبر', 'Last heard')} {job.lastHeardAt ? formatDateTime(job.lastHeardAt, lang) : '—'}</span>
                <Cancel onDone={() => setVersion((v) => v + 1)} run={(reason) => auth.admin.cancelAiJob(job.id, reason)} />
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel flush title={t('آخر المهام الفاشلة', 'Latest failures')} sub={t('نص المزوّد كما هو — لا يراه التاجر.', 'The provider’s own words — the merchant never sees them.')}>
        {data.failures.length === 0 ? <p className="hint" style={{ margin: 16 }}>{t('لا شيء.', 'None.')}</p> : (
          <ul className="ops-list">
            {data.failures.map((job) => (
              <li key={job.id}>
                <JobLine job={job} type={type(job.type)} store={store(job.store)} />
                <p className="ops-error" dir="ltr">{job.errorCode}: {job.errorMessage}</p>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <Panel title={t('المتاجر الأعلى تكلفة', 'Stores costing the most')} flush>
        {data.topStores.length === 0 ? <p className="hint" style={{ margin: 16 }}>{t('لا شيء.', 'None.')}</p> : (
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th scope="col">{t('المتجر', 'Store')}</th><th scope="col">{t('مهام', 'Jobs')}</th><th scope="col">{t('التكلفة', 'Cost')}</th><th scope="col">{t('الأرصدة', 'Credits')}</th></tr></thead>
              <tbody>
                {data.topStores.map((s) => (
                  <tr key={s.id}>
                    <td>{store(s)}</td><td className="num">{formatNumber(s.jobs, lang)}</td>
                    <td className="num" dir="ltr">{usd(s.costCents)}</td><td className="num">{formatNumber(s.creditsCharged, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}

function JobLine({ job, type, store }: { job: AdminAiJob; type: string; store: string }) {
  const { t, lang } = useLang();
  return (
    <span style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <strong>{type}</strong><span>{store}</span>
      {job.status === 'failed' ? <Badge tone="bad">{t('فشلت', 'Failed')}</Badge> : <Badge tone="warn">{t('صامتة', 'Quiet')}</Badge>}
      <span className="hint" style={{ margin: 0 }}>{job.startedAt ? formatDateTime(job.startedAt, lang) : '—'}</span>
    </span>
  );
}

/** Cancelling needs a reason: the button opens a one-line form, then does it. */
function Cancel({ run, onDone }: { run: (reason: string) => Promise<void>; onDone: () => void }) {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!open) return <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>{t('ألغِ المهمة', 'Cancel the job')}</button>;
  return (
    <form className="ops-retry" onSubmit={async (e) => {
      e.preventDefault();
      if (reason.trim().length < 5) return;
      setBusy(true); setProblem(null);
      try { await run(reason.trim()); onDone(); } catch (err) { setProblem((err as Error).message); setBusy(false); }
    }}>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('السبب', 'Reason')} aria-label={t('السبب', 'Reason')} maxLength={500} autoFocus />
      <button type="submit" className="btn btn-accent btn-sm" disabled={busy || reason.trim().length < 5}>{t('ألغِ', 'Cancel it')}</button>
      <span className="hint" style={{ margin: 0 }}>{t('بدأ المزوّد العمل، فيبقى الرصيد مخصومًا (T24).', 'The provider had started, so the charge stays (T24).')}</span>
      {problem && <span className="field-error">{problem}</span>}
    </form>
  );
}

/**
 * P6.7 — the brakes. Empty means no limit; nothing is limited until staff set it here. Every change
 * needs a reason and is written to the staff trail with what it was before.
 */
function Guardrails({ value, type, onSaved }: { value: AdminAiGuardrails & { spentTodayCents: number }; type: (key: string) => string; onSaved: () => void }) {
  const { t, lang } = useLang();
  const auth = useAuth();
  const [paused, setPaused] = useState<string[]>(value.pausedTypes);
  const [spendCap, setSpendCap] = useState(value.dailySpendCapCents === null ? '' : String(value.dailySpendCapCents / 100));
  const [jobsCap, setJobsCap] = useState(value.storeDailyJobsCap === null ? '' : String(value.storeDailyJobsCap));
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const usd = (cents: number) => formatMoney(cents, 'USD', lang);
  const capReached = value.dailySpendCapCents !== null && value.spentTodayCents >= value.dailySpendCapCents;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const dollars = spendCap.trim() === '' ? null : Number(spendCap);
    const jobs = jobsCap.trim() === '' ? null : Number(jobsCap);
    if (dollars !== null && !(Number.isFinite(dollars) && dollars >= 0)) { setProblem(t('حد الإنفاق مبلغ بالدولار، صفر أو أكثر.', 'The spend cap is an amount in dollars, 0 or more.')); return; }
    if (jobs !== null && !(Number.isInteger(jobs) && jobs >= 0)) { setProblem(t('حد المهام عدد صحيح، صفر أو أكثر.', 'The job cap is a whole number, 0 or more.')); return; }
    setBusy(true); setProblem(null);
    try {
      await auth.admin.setAiGuardrails({ pausedTypes: paused, dailySpendCapCents: dollars === null ? null : Math.round(dollars * 100), storeDailyJobsCap: jobs, reason: reason.trim() });
      setReason('');
      onSaved();
    } catch (err) { setProblem((err as Error).message); } finally { setBusy(false); }
  };

  return (
    <Panel title={t('حدود الإنفاق', 'Spend guardrails')}
      sub={t('توقف العمل الجديد قبل أي خصم. الحقل الفارغ يعني بلا حد — ولا حد حتى تضعه هنا.', 'They stop new work before anything is charged. An empty field means no limit — nothing is limited until you set it here.')}>
      <div className="grid grid-3">
        <Stat label={t('تكلفة اليوم', 'Spent today')} value={usd(value.spentTodayCents)}
          sub={value.dailySpendCapCents === null ? t('لا حد يومي', 'No daily cap') : t(`من ${usd(value.dailySpendCapCents)} — بتوقيت الرياض`, `of ${usd(value.dailySpendCapCents)} — Riyadh day`)} />
        <Stat label={t('الحالة', 'State')} value={capReached ? t('متوقف حتى الغد', 'Paused until tomorrow') : value.pausedTypes.length ? t('متوقف جزئيًا', 'Partly paused') : t('يعمل', 'Running')}
          sub={value.pausedTypes.length ? value.pausedTypes.map(type).join('، ') : t('لا نوع متوقف', 'Nothing paused')} />
        <Stat label={t('حد المتجر اليومي', 'Per-store daily cap')} value={value.storeDailyJobsCap === null ? t('بلا حد', 'None') : formatNumber(value.storeDailyJobsCap, lang)}
          sub={t('مهام يبدؤها متجر واحد في اليوم', 'AI jobs one store may start a day')} />
      </div>
      {capReached && <p className="field-error" role="status" style={{ margin: '14px 0 0' }}>{t('بلغت تكلفة اليوم الحد: كل عمل جديد مرفوض حتى منتصف الليل. العمل الجاري يكمل.', 'Today’s cost has reached the cap: all new work is refused until midnight. Work already running finishes.')}</p>}
      <form className="guardrails-form" onSubmit={save}>
        <fieldset>
          <legend>{t('أوقف هذه الأنواع', 'Pause these kinds of work')}</legend>
          {Object.keys(TYPES).map((key) => (
            <label key={key} className="toggle">
              <input type="checkbox" checked={paused.includes(key)} onChange={(e) => setPaused((p) => (e.target.checked ? [...p, key] : p.filter((k) => k !== key)))} />
              <span>{type(key)}</span>
            </label>
          ))}
        </fieldset>
        <label className="field">
          <span>{t('حد الإنفاق اليومي (دولار)', 'Daily spend cap (US dollars)')}</span>
          <input inputMode="decimal" dir="ltr" value={spendCap} onChange={(e) => setSpendCap(e.target.value)} placeholder={t('بلا حد', 'No cap')} />
        </label>
        <label className="field">
          <span>{t('حد مهام المتجر في اليوم', 'AI jobs per store per day')}</span>
          <input inputMode="numeric" dir="ltr" value={jobsCap} onChange={(e) => setJobsCap(e.target.value)} placeholder={t('بلا حد', 'No cap')} />
        </label>
        <label className="field">
          <span>{t('السبب', 'Reason')}</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={t('مثلًا: المزوّد رفع سعره', 'e.g. the provider raised its price')} />
        </label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || reason.trim().length < 5}>{busy ? t('جارٍ الحفظ…', 'Saving…') : t('احفظ الحدود', 'Save the guardrails')}</button>
          {value.updatedAt && <span className="hint" style={{ margin: 0 }}>{t('آخر تغيير', 'Last changed')} {formatDateTime(value.updatedAt, lang)}</span>}
        </div>
        {problem && <p className="field-error" role="alert">{problem}</p>}
      </form>
    </Panel>
  );
}
