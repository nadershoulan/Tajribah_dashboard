'use client';

// ADM-13 — Plans · ADM-14 — edit a plan's prices, limits and features (A6)

import { useEffect, useState } from 'react';
import { useAuth, type AdminPlan, type AdminPlanChange } from '@/lib/auth';
import { useLang } from '@/lib/i18n';
import { foldDigits, formatMoney } from '@/lib/money';
import { FEATURE_LABELS, LIMIT_LABELS, UNLIMITED, planByCode, type PlanLimits } from '@/lib/plans';
import { AdminShell } from '@/components/admin/shell';
import { ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

const LIMIT_KEYS = Object.keys(LIMIT_LABELS) as (keyof PlanLimits)[];
const UNITS: Partial<Record<keyof PlanLimits, { ar: string; en: string }>> = { storage_gb: { ar: 'GB', en: 'GB' }, bandwidth_gb: { ar: 'GB', en: 'GB' } };

export default function AdminPlans() {
  const { t } = useLang();
  return <AdminShell title={t('الباقات والأسعار', 'Plans and pricing')}><Plans /></AdminShell>;
}

function Plans() {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  // `loads` counts finished fetches: the editor starts afresh from each one, never from the rows it just replaced.
  const [loaded, setLoaded] = useState<{ plans: AdminPlan[]; loads: number } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [code, setCode] = useState<AdminPlan['code']>('starter');
  const [version, setVersion] = useState(0);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    auth.admin.plans().then((plans) => { if (live) setLoaded((prev) => ({ plans, loads: (prev?.loads ?? 0) + 1 })); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, version]);

  if (error) return <ErrorNote error={error} />;
  if (!loaded) return <Panel><Loading rows={6} /></Panel>;
  const { plans, loads } = loaded;
  const plan = plans.find((p) => p.code === code) ?? plans[0]!;
  return (
    <>
      <div className="plan-tabs" role="tablist" aria-label={t('الباقة', 'Plan')}>
        {plans.map((p) => (
          <button key={p.code} type="button" role="tab" aria-selected={p.code === plan.code} className={`plan-tab${p.code === plan.code ? ' on' : ''}`} onClick={() => { setCode(p.code); setNotice(null); }}>
            <strong>{lang === 'ar' ? p.nameAr : p.name}</strong>
            <span>{p.priceMonthlyMinor == null ? t('بلا سعر معلن', 'No list price') : `${formatMoney(p.priceMonthlyMinor, p.currency, lang, { compact: true })} / ${t('شهر', 'mo')}`}</span>
            <span>{t(`${p.subscribers} متجر`, `${p.subscribers} store${p.subscribers === 1 ? '' : 's'}`)}</span>
          </button>
        ))}
      </div>
      {notice && <p role="status" className="plan-notice">{notice}</p>}
      <Editor key={`${plan.code}:${loads}`} plan={plan} onSaved={(message) => { setNotice(message); setVersion((v) => v + 1); }} />
      <Panel title={t('نصوص البطاقة', 'Card copy')} sub={t('هذه الأسطر نص ثابت في lib/plans.ts لا يتغيّر من هنا. إن ذكرت رقمًا غيّرته فعدّلها أيضًا.', 'These lines are fixed copy in lib/plans.ts and do not change from here. If one names a number you change, update it too.')}>
        <ul className="plain-list">{planByCode(plan.code).highlights.map((h) => <li key={h.en}>{pick(h)}</li>)}</ul>
      </Panel>
    </>
  );
}

type Form = {
  talk: boolean; monthly: string; annual: string;
  limits: Record<keyof PlanLimits, { unlimited: boolean; value: string }>;
  features: Record<string, boolean>;
  reason: string;
};

const sar = (minor: number | null) => (minor == null ? '' : (minor / 100).toFixed(minor % 100 === 0 ? 0 : 2));
const toMinor = (text: string): number | null => {
  const v = foldDigits(text).trim();
  return /^\d{1,7}(\.\d{1,2})?$/.test(v) ? Math.round(Number(v) * 100) : null;
};
const toCount = (text: string): number | null => {
  const v = foldDigits(text).trim().replace(/[,،]/g, '');
  return /^\d{1,9}$/.test(v) ? Number(v) : null;
};

function formOf(plan: AdminPlan): Form {
  return {
    talk: plan.priceMonthlyMinor == null, monthly: sar(plan.priceMonthlyMinor), annual: sar(plan.priceAnnualMinor),
    limits: Object.fromEntries(LIMIT_KEYS.map((k) => [k, { unlimited: plan.limits[k] === UNLIMITED, value: plan.limits[k] === UNLIMITED ? '' : String(plan.limits[k]) }])) as Form['limits'],
    features: { ...plan.features },
    reason: '',
  };
}

/** What the form would change, or the fields that do not parse. */
function changeOf(plan: AdminPlan, form: Form): { change: Omit<AdminPlanChange, 'reason'>; bad: string[]; count: number } {
  const bad: string[] = [];
  const change: Omit<AdminPlanChange, 'reason'> = {};
  const monthly = form.talk ? null : toMinor(form.monthly);
  const annual = form.talk ? null : toMinor(form.annual);
  if (!form.talk && monthly == null) bad.push('monthly');
  if (!form.talk && annual == null) bad.push('annual');
  if (!bad.length) {
    if (monthly !== plan.priceMonthlyMinor) change.priceMonthlyMinor = monthly;
    if (annual !== plan.priceAnnualMinor) change.priceAnnualMinor = annual;
  }
  const limits: Partial<PlanLimits> = {};
  for (const k of LIMIT_KEYS) {
    const v = form.limits[k].unlimited ? UNLIMITED : toCount(form.limits[k].value);
    if (v == null) bad.push(k);
    else if (v !== plan.limits[k]) limits[k] = v;
  }
  if (Object.keys(limits).length) change.limits = limits;
  const features = Object.fromEntries(Object.entries(form.features).filter(([k, on]) => on !== plan.features[k]));
  if (Object.keys(features).length) change.features = features;
  const count = (change.priceMonthlyMinor !== undefined ? 1 : 0) + (change.priceAnnualMinor !== undefined ? 1 : 0) + Object.keys(limits).length + Object.keys(features).length;
  return { change, bad, count };
}

function Editor({ plan, onSaved }: { plan: AdminPlan; onSaved: (message: string) => void }) {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  const [form, setForm] = useState<Form>(() => formOf(plan));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { change, bad, count } = changeOf(plan, form);
  const lowered = LIMIT_KEYS.filter((k) => change.limits?.[k] !== undefined && plan.limits[k] !== UNLIMITED && change.limits[k] !== UNLIMITED && change.limits[k]! < plan.limits[k]
    || change.limits?.[k] !== undefined && plan.limits[k] === UNLIMITED && change.limits[k] !== UNLIMITED);
  const ready = count > 0 && bad.length === 0 && form.reason.trim().length >= 5;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setProblem(null);
    try {
      const { changed } = await auth.admin.updatePlan(plan.code, { ...change, reason: form.reason.trim() });
      onSaved(t(`حُفظ ${changed.length} تغيير على باقة ${plan.nameAr}.`, `Saved ${changed.length} change${changed.length === 1 ? '' : 's'} to ${plan.name}.`));
    } catch (err) {
      setProblem((err as Error).message);
    } finally { setBusy(false); }
  };

  const limit = (k: keyof PlanLimits, patch: Partial<Form['limits'][keyof PlanLimits]>) => setForm({ ...form, limits: { ...form.limits, [k]: { ...form.limits[k], ...patch } } });
  return (
    <form onSubmit={save} noValidate className="plan-editor">
      <div className="grid grid-2">
        <Panel title={t('السعر', 'Price')} sub={t('بالريال، قبل الضريبة', 'In SAR, before VAT')}>
          <label className="toggle" style={{ marginBottom: 14 }}>
            <input type="checkbox" checked={form.talk} onChange={(e) => setForm({ ...form, talk: e.target.checked })} />
            <span>{t('بلا سعر معلن (تواصل معنا)', 'No list price (talk to us)')}</span>
          </label>
          <div className="brand-row">
            <div className="field">
              <label htmlFor="plan-monthly">{t('شهريًا', 'Monthly')}</label>
              <input id="plan-monthly" dir="ltr" inputMode="decimal" value={form.monthly} disabled={form.talk} onChange={(e) => setForm({ ...form, monthly: e.target.value })} aria-invalid={bad.includes('monthly')} />
            </div>
            <div className="field">
              <label htmlFor="plan-annual">{t('سنويًا', 'Annual')}</label>
              <input id="plan-annual" dir="ltr" inputMode="decimal" value={form.annual} disabled={form.talk} onChange={(e) => setForm({ ...form, annual: e.target.value })} aria-invalid={bad.includes('annual')} />
            </div>
          </div>
          <p className="hint" style={{ margin: 0 }}>{t('يظهر السعر الجديد في صفحة الاشتراك وعند الدفع فورًا، ويُحتسب من فترة الفوترة التالية.', 'The new price shows on the billing page and at checkout at once, and applies from the next billing period.')}</p>
        </Panel>
        <Panel title={t('الحدود', 'Limits')} sub={t('الأرقام الشهرية تبدأ من أول الشهر', 'Monthly figures reset on the 1st')}>
          {LIMIT_KEYS.map((k) => (
            <div className="limit-row" key={k}>
              <label htmlFor={`limit-${k}`}>{pick(LIMIT_LABELS[k])}{UNITS[k] ? ` (${pick(UNITS[k]!)})` : ''}</label>
              <input id={`limit-${k}`} dir="ltr" inputMode="numeric" value={form.limits[k].value} disabled={form.limits[k].unlimited}
                onChange={(e) => limit(k, { value: e.target.value })} aria-invalid={bad.includes(k)} />
              <label className="toggle"><input type="checkbox" checked={form.limits[k].unlimited} onChange={(e) => limit(k, { unlimited: e.target.checked })} /><span>{t('بلا حد', 'Unlimited')}</span></label>
            </div>
          ))}
        </Panel>
      </div>
      <Panel title={t('المزايا', 'Features')}>
        <div className="feature-grid">
          {Object.keys(FEATURE_LABELS).map((k) => (
            <label className="toggle" key={k}>
              <input type="checkbox" checked={!!form.features[k]} onChange={(e) => setForm({ ...form, features: { ...form.features, [k]: e.target.checked } })} />
              <span>{pick(FEATURE_LABELS[k]!)}</span>
            </label>
          ))}
        </div>
      </Panel>
      <Panel
        title={t('حفظ التغيير', 'Save the change')}
        sub={t(`يسري فورًا على ${plan.subscribers} متجر على هذه الباقة — لا يحتفظ أحد بالشروط القديمة.`, `Applies at once to the ${plan.subscribers} store${plan.subscribers === 1 ? '' : 's'} on this plan — nobody keeps the old terms.`)}
      >
        {lowered.length > 0 && (
          <p className="hint" role="note" style={{ marginTop: 0, color: 'var(--warn)' }}>
            {t('خفّضت حدًا: لا يُحذف شيء، لكن المتجر الذي تجاوزه لن يستطيع الإضافة. أبلغ المتاجر قبل الحفظ.', 'You lowered a limit: nothing is deleted, but a store already over it cannot add more. Tell the stores before you save.')}
            {' '}({lowered.map((k) => pick(LIMIT_LABELS[k])).join(lang === 'ar' ? '، ' : ', ')})
          </p>
        )}
        <div className="admin-actions">
          <div className="field act-reason">
            <label htmlFor="plan-reason">{t('السبب', 'Reason')}</label>
            <input id="plan-reason" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} maxLength={500} placeholder={t('مثال: تسعير أكتوبر', 'e.g. October pricing')} />
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" disabled={busy || count === 0} onClick={() => setForm(formOf(plan))}>{t('تراجع', 'Undo')}</button>
            <button type="submit" className="btn btn-accent" disabled={busy || !ready}>
              {busy ? t('جارٍ الحفظ…', 'Saving…') : count === 0 ? t('لا تغيير', 'No change') : t(`احفظ ${count} تغيير`, `Save ${count} change${count === 1 ? '' : 's'}`)}
            </button>
          </div>
        </div>
        {bad.length > 0 && <p className="field-error" style={{ margin: '8px 0 0' }}>{t('رقم غير صالح في حقل مظلَّل.', 'A highlighted field is not a valid number.')}</p>}
        {problem && <p className="field-error" role="alert" style={{ margin: '8px 0 0' }}>{t('لم يُحفظ: ', 'Not saved: ')}<span dir="ltr">{problem}</span></p>}
      </Panel>
    </form>
  );
}
