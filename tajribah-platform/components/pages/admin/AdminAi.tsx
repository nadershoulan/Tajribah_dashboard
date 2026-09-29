'use client';

// A9 — AI operations: jobs by type, what the work cost us beside the credits charged, failures, quiet jobs
// P6.7 — and the guardrails: kinds of work paused, the platform's daily spend cap, each store's daily job cap
// P6 — and the model registry & A/B: which model does each kind of work, its share, and how its jobs went

import { useEffect, useState, type FormEvent } from 'react';
import { Cpu } from 'lucide-react';
import { useAuth, type AdminAiGuardrails, type AdminAiJob, type AdminAiModel, type AdminAiOperations } from '@/lib/auth';
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

      <Models days={days} type={type} />

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

/**
 * P6 — the model registry & A/B. Each kind of AI work lists the provider models it can use: their
 * share of new jobs, and how their jobs did (from the jobs themselves). Staff add a model (it starts
 * off), switch models on and off, set the shares (they must add up to 100) and roll one back — its
 * share goes to the others. Every change needs a reason and goes to the staff trail.
 */
function Models({ days, type }: { days: 7 | 30 | 90; type: (key: string) => string }) {
  const { t } = useLang();
  const auth = useAuth();
  const [models, setModels] = useState<AdminAiModel[] | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    let live = true;
    auth.admin.aiModels(days).then((m) => { if (live) setModels(m); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, days]);

  const reload = () => auth.admin.aiModels(days).then(setModels, setError);
  const types = Object.keys(TYPES).filter((key) => models?.some((m) => m.jobType === key));

  return (
    <Panel title={t('النماذج وتجارب A/B', 'Models and A/B')}
      sub={t('أي نموذج ينفّذ كل نوع من العمل، وبأي نسبة من المهام الجديدة، وكيف كانت نتائجه. المهمة الجارية تبقى مع نموذجها.', 'Which provider model does each kind of work, for what share of new jobs, and how its jobs went. A job already running keeps its model.')}>
      {error ? <ErrorNote error={error} /> : !models ? <Loading rows={3} /> : (
        <>
          {types.length === 0 && <p className="hint" style={{ marginTop: 0 }}>{t('لا نماذج مسجّلة بعد: كل مهمة تذهب إلى النموذج الافتراضي لمنفّذها.', 'No models registered yet: every job goes to its executor’s default.')}</p>}
          {types.map((key) => (
            <TypeModels key={key} label={type(key)} jobType={key} models={models.filter((m) => m.jobType === key)} onChange={setModels} />
          ))}
          {adding
            ? <AddModel type={type} onDone={() => { setAdding(false); void reload(); }} onCancel={() => setAdding(false)} />
            : <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }} onClick={() => setAdding(true)}>{t('أضف نموذجًا', 'Add a model')}</button>}
        </>
      )}
    </Panel>
  );
}

function TypeModels({ label, jobType, models, onChange }: { label: string; jobType: string; models: AdminAiModel[]; onChange: (m: AdminAiModel[]) => void }) {
  const { t, lang } = useLang();
  const auth = useAuth();
  const active = models.filter((m) => m.active);
  const [shares, setShares] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const usd = (cents: number) => formatMoney(cents, 'USD', lang);
  const share = (m: AdminAiModel) => Number(shares[m.id] ?? m.split);
  const total = active.reduce((n, m) => n + (share(m) || 0), 0);
  const valid = active.every((m) => Number.isInteger(share(m)) && share(m) >= 0 && share(m) <= 100) && total === 100;

  return (
    <section className="model-type">
      <h3>{label}</h3>
      <div className="table-wrap">
        <table className="data">
          <thead><tr>
            <th scope="col">{t('النموذج', 'Model')}</th><th scope="col">{t('المزوّد', 'Provider')}</th><th scope="col">{t('الحالة', 'State')}</th>
            <th scope="col">{t('النسبة', 'Share')}</th><th scope="col">{t('مهام', 'Jobs')}</th><th scope="col">{t('نجحت', 'Succeeded')}</th>
            <th scope="col">{t('المدة (الوسيط)', 'Median time')}</th><th scope="col">{t('التكلفة للمهمة', 'Cost per job')}</th><th scope="col">{t('إجراءات', 'Actions')}</th>
          </tr></thead>
          <tbody>
            {models.map((m) => (
              <tr key={m.id}>
                <td style={{ whiteSpace: 'nowrap' }}><strong dir="ltr">{m.name}</strong> <span className="hint" style={{ margin: 0 }} dir="ltr">{m.version}</span></td>
                <td dir="ltr" style={{ whiteSpace: 'nowrap' }}>{m.provider}</td>
                <td>{m.active ? <Badge tone="ok">{t('يعمل', 'On')}</Badge> : m.rolledBackAt
                  ? <Badge tone="bad">{t('تراجعنا عنه', 'Rolled back')} · {formatDateTime(m.rolledBackAt, lang)}</Badge>
                  : <Badge>{t('متوقف', 'Off')}</Badge>}</td>
                <td className="num">
                  {editing && m.active
                    ? <input className="share-input" inputMode="numeric" dir="ltr" aria-label={t(`نسبة ${m.name}`, `${m.name} share`)} value={shares[m.id] ?? String(m.split)} onChange={(e) => setShares((s) => ({ ...s, [m.id]: e.target.value }))} />
                    : m.active ? formatPercent(m.split / 100, lang) : '—'}
                </td>
                <td className="num">{formatNumber(m.outcomes?.jobs ?? 0, lang)}</td>
                <td className="num" style={{ color: m.outcomes?.successRate != null && m.outcomes.successRate < 0.9 ? 'var(--bad)' : undefined }}>{m.outcomes?.successRate == null ? '—' : formatPercent(m.outcomes.successRate, lang)}</td>
                <td className="num">{duration(m.outcomes?.medianSeconds ?? null, t)}</td>
                <td className="num" dir="ltr">{m.outcomes?.jobs ? usd(Math.round(m.outcomes.costCents / m.outcomes.jobs)) : '—'}</td>
                <td>
                  <div className="ops-retry">
                    <WithReason label={m.active ? t('أوقفه', 'Switch off') : t('شغّله', 'Switch on')} confirm={m.active ? t('أوقف', 'Switch off') : t('شغّل', 'Switch on')}
                      note={m.active ? t('نسبته تذهب إلى الباقين.', 'Its share goes to the others.') : active.length ? t('يبدأ بنسبة 0% حتى تعطيه نسبة.', 'It starts at 0% until you give it a share.') : t('وحده، فيأخذ كل المهام.', 'Alone, so it takes every job.')}
                      run={async (reason) => onChange(await auth.admin.setAiModelActive(m.id, !m.active, reason))} />
                    {m.active && <WithReason label={t('تراجع عنه', 'Roll back')} confirm={t('تراجع عنه', 'Roll back')} tone="accent"
                      note={t('يتوقف الآن، ونسبته تذهب إلى الباقين، ويُسجَّل الوقت.', 'Off now, its share to the others, and the time recorded.')}
                      run={async (reason) => onChange(await auth.admin.rollbackAiModel(m.id, reason))} />}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {active.length > 1 && (editing
        ? (
          <div className="ops-retry" style={{ marginTop: 10 }}>
            <span style={{ color: total === 100 ? undefined : 'var(--bad)' }}>{t(`المجموع ${total}% — يجب أن يكون 100%`, `Total ${total}% — it must be 100%`)}</span>
            <WithReason open label="" confirm={t('احفظ النسب', 'Save the shares')} disabled={!valid}
              run={async (reason) => {
                onChange(await auth.admin.setAiSplits({ jobType, splits: active.map((m) => ({ id: m.id, percent: share(m) })), reason }));
                setEditing(false); setShares({});
              }} />
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditing(false); setShares({}); }}>{t('تراجع', 'Never mind')}</button>
          </div>
        )
        : <button type="button" className="btn btn-ghost btn-sm" style={{ marginTop: 10 }} onClick={() => setEditing(true)}>{t('غيّر النسب', 'Change the shares')}</button>)}
    </section>
  );
}

/** A button that asks for a reason (5 characters or more) before it does its thing. */
function WithReason({ label, confirm, note, run, tone, open: startOpen = false, disabled = false }: {
  label: string; confirm: string; note?: string; run: (reason: string) => Promise<void>; tone?: 'accent'; open?: boolean; disabled?: boolean;
}) {
  const { t } = useLang();
  const [open, setOpen] = useState(startOpen);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!open) return <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(true)}>{label}</button>;
  return (
    <form className="ops-retry" onSubmit={async (e) => {
      e.preventDefault();
      if (reason.trim().length < 5 || disabled) return;
      setBusy(true); setProblem(null);
      try { await run(reason.trim()); setOpen(startOpen); setReason(''); } catch (err) { setProblem((err as Error).message); } finally { setBusy(false); }
    }}>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('السبب', 'Reason')} aria-label={t('السبب', 'Reason')} maxLength={500} autoFocus={!startOpen} />
      <button type="submit" className={`btn btn-sm ${tone === 'accent' ? 'btn-accent' : 'btn-primary'}`} disabled={busy || disabled || reason.trim().length < 5}>{confirm}</button>
      {!startOpen && <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setOpen(false); setProblem(null); }}>{t('تراجع', 'Never mind')}</button>}
      {note && <span className="hint" style={{ margin: 0 }}>{note}</span>}
      {problem && <span className="field-error">{problem}</span>}
    </form>
  );
}

function AddModel({ type, onDone, onCancel }: { type: (key: string) => string; onDone: () => void; onCancel: () => void }) {
  const { t } = useLang();
  const auth = useAuth();
  const [form, setForm] = useState({ name: '', version: '', provider: '', endpoint: '', jobType: 'generate_3d', cost: '', reason: '' });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const dollars = Number(form.cost);
    if (form.cost.trim() === '' || !(Number.isFinite(dollars) && dollars >= 0)) { setProblem(t('تكلفة المهمة مبلغ بالدولار، صفر أو أكثر.', 'The cost per call is an amount in dollars, 0 or more.')); return; }
    setBusy(true); setProblem(null);
    try {
      await auth.admin.registerAiModel({
        name: form.name.trim(), version: form.version.trim(), provider: form.provider.trim(), endpoint: form.endpoint.trim() || null,
        jobType: form.jobType, costPerCallCents: Math.round(dollars * 100), reason: form.reason.trim(),
      });
      onDone();
    } catch (err) { setProblem((err as Error).message); setBusy(false); }
  };

  return (
    <form className="guardrails-form" onSubmit={save}>
      <p className="hint" style={{ margin: 0 }}>{t('يُضاف متوقفًا، بنسبة 0%. شغّله ثم أعطه نسبة.', 'It is added switched off, at 0%. Switch it on, then give it a share.')}</p>
      <label className="field"><span>{t('نوع العمل', 'Kind of work')}</span>
        <select value={form.jobType} onChange={set('jobType')}>{Object.keys(TYPES).map((key) => <option key={key} value={key}>{type(key)}</option>)}</select>
      </label>
      <label className="field"><span>{t('الاسم', 'Name')}</span><input dir="ltr" value={form.name} onChange={set('name')} maxLength={80} /></label>
      <label className="field"><span>{t('الإصدار', 'Version')}</span><input dir="ltr" value={form.version} onChange={set('version')} maxLength={40} /></label>
      <label className="field"><span>{t('المزوّد', 'Provider')}</span><input dir="ltr" value={form.provider} onChange={set('provider')} maxLength={40} /></label>
      <label className="field"><span>{t('العنوان (https، اختياري)', 'Endpoint (https, optional)')}</span><input dir="ltr" value={form.endpoint} onChange={set('endpoint')} placeholder="https://" /></label>
      <label className="field"><span>{t('التكلفة لكل مهمة (دولار)', 'Cost per call (US dollars)')}</span><input inputMode="decimal" dir="ltr" value={form.cost} onChange={set('cost')} /></label>
      <label className="field"><span>{t('السبب', 'Reason')}</span><input value={form.reason} onChange={set('reason')} maxLength={500} /></label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="submit" className="btn btn-primary btn-sm" disabled={busy || form.reason.trim().length < 5 || !form.name.trim() || !form.version.trim() || !form.provider.trim()}>{t('أضف النموذج', 'Add the model')}</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>{t('تراجع', 'Never mind')}</button>
      </div>
      {problem && <p className="field-error" role="alert">{problem}</p>}
    </form>
  );
}
