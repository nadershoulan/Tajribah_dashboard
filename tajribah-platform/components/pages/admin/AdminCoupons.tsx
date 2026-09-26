'use client';

// ADM-15 — Coupons (A13)

import { useEffect, useState } from 'react';
import { useAuth, type AdminCoupon, type AdminCouponFields } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { foldDigits, formatMoney } from '@/lib/money';
import { PLANS, planByCode, type PlanCode } from '@/lib/plans';
import { AdminShell } from '@/components/admin/shell';
import { Badge, Empty, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

export default function AdminCoupons() {
  const { t } = useLang();
  return <AdminShell title={t('كوبونات الخصم', 'Coupons')}><Coupons /></AdminShell>;
}

type Editing = { mode: 'new' } | { mode: 'edit'; coupon: AdminCoupon } | null;

function Coupons() {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  const [loaded, setLoaded] = useState<{ coupons: AdminCoupon[]; loads: number } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  const [editing, setEditing] = useState<Editing>(null);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    auth.admin.coupons().then((coupons) => { if (live) setLoaded((prev) => ({ coupons, loads: (prev?.loads ?? 0) + 1 })); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, version]);

  if (error) return <ErrorNote error={error} />;
  if (!loaded) return <Panel><Loading rows={4} /></Panel>;
  const offer = (c: AdminCoupon) => c.kind === 'percent' ? t(`خصم ${c.percentOff}%`, `${c.percentOff}% off`)
    : c.kind === 'fixed' ? t(`خصم ${formatMoney(c.amountOffMinor ?? 0, 'SAR', lang)}`, `${formatMoney(c.amountOffMinor ?? 0, 'SAR', lang)} off`)
    : t(`${c.freeMonths} أشهر مجانًا`, `${c.freeMonths} free months`);
  const period = (c: AdminCoupon) => (c.validFrom || c.validUntil)
    ? `${c.validFrom ? formatDate(c.validFrom, lang) : '…'} – ${c.validUntil ? formatDate(lastDay(c.validUntil), lang) : '…'}` : t('بلا موعد', 'Any time');
  const saved = (message: string) => { setNotice(message); setEditing(null); setVersion((v) => v + 1); };

  return (
    <div className="ops">
      {notice && <p role="status" className="plan-notice">{notice}</p>}
      {editing && <Form key={editing.mode === 'edit' ? `${editing.coupon.id}:${loaded.loads}` : 'new'} editing={editing} onCancel={() => setEditing(null)} onSaved={saved} />}
      <Panel flush title={t('كل الكوبونات', 'Every coupon')} sub={t('يُتحقق من الكوبون في الخادم عند الدفع؛ يُستخدم مرة لكل متجر.', 'Checked on the server at checkout; once per store.')}
        actions={!editing ? <button type="button" className="btn btn-accent btn-sm" onClick={() => { setNotice(null); setEditing({ mode: 'new' }); }}>{t('كوبون جديد', 'New coupon')}</button> : undefined}>
        {loaded.coupons.length === 0 ? <Empty title={t('لا كوبونات', 'No coupons')} body={t('أنشئ أول كوبون من الزر أعلاه.', 'Create the first one with the button above.')} /> : (
          <div className="table-wrap"><table className="data">
            <thead><tr>
              <th scope="col">{t('الرمز', 'Code')}</th><th scope="col">{t('العرض', 'Offer')}</th><th scope="col">{t('الباقات', 'Plans')}</th>
              <th scope="col">{t('المدة', 'Valid')}</th><th scope="col" className="num">{t('الاستخدام', 'Used')}</th><th scope="col">{t('الحالة', 'Status')}</th><th scope="col" />
            </tr></thead>
            <tbody>
              {loaded.coupons.map((c) => (
                <tr key={c.id}>
                  <td className="cell-main"><span className="mm" dir="ltr">{c.code}</span>{c.note && <span className="lines">{c.note}</span>}</td>
                  <td>{offer(c)}</td>
                  <td>{c.appliesTo ? c.appliesTo.map((p) => pick(planByCode(p).name)).join(lang === 'ar' ? '، ' : ', ') : t('كلها', 'All')}</td>
                  <td>{period(c)}</td>
                  <td className="num">{c.redemptions}{c.maxRedemptions != null ? ` / ${c.maxRedemptions}` : ''}</td>
                  <td><Badge tone={c.active ? 'ok' : 'neutral'}>{c.active ? t('فعّال', 'On') : t('متوقف', 'Off')}</Badge></td>
                  <td><button type="button" className="btn btn-ghost btn-sm" onClick={() => { setNotice(null); setEditing({ mode: 'edit', coupon: c }); }}>{t('تعديل', 'Edit')}</button></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </Panel>
    </div>
  );
}

type FormState = {
  code: string; kind: AdminCouponFields['kind']; value: string; allPlans: boolean; plans: PlanCode[];
  limit: string; from: string; until: string; active: boolean; note: string; reason: string;
};

/** The end is stored as the first instant it no longer applies; people read the last day it does. */
const lastDay = (until: string) => new Date(Date.parse(until) - 1).toISOString();

/** Dates are whole days in Riyadh: a coupon valid "until 31 Oct" stops at the start of 1 Nov there. */
const toIso = (day: string, end: boolean): string | null => {
  if (!day) return null;
  const start = new Date(`${day}T00:00:00+03:00`);
  return new Date(start.getTime() + (end ? 86_400_000 : 0)).toISOString();
};
const toDay = (iso: string | null, end: boolean): string => {
  if (!iso) return '';
  const riyadh = new Date(new Date(iso).getTime() + 3 * 3_600_000 - (end ? 86_400_000 : 0));
  return riyadh.toISOString().slice(0, 10);
};

function stateOf(c: AdminCoupon | null): FormState {
  if (!c) return { code: '', kind: 'percent', value: '', allPlans: true, plans: [], limit: '', from: '', until: '', active: true, note: '', reason: '' };
  const value = c.kind === 'percent' ? String(c.percentOff ?? '') : c.kind === 'fixed' ? String((c.amountOffMinor ?? 0) / 100) : String(c.freeMonths ?? '');
  return {
    code: c.code, kind: c.kind, value, allPlans: !c.appliesTo, plans: c.appliesTo ?? [], limit: c.maxRedemptions != null ? String(c.maxRedemptions) : '',
    from: toDay(c.validFrom, false), until: toDay(c.validUntil, true), active: c.active, note: c.note ?? '', reason: '',
  };
}

function fieldsOf(f: FormState): AdminCouponFields | null {
  const n = Number(foldDigits(f.value).trim());
  const whole = Number.isFinite(n) && f.value.trim() !== '';
  const limit = f.limit.trim() === '' ? null : Number(foldDigits(f.limit).trim());
  if (!whole || (limit !== null && !Number.isInteger(limit))) return null;
  return {
    code: f.code.trim().toUpperCase().replace(/\s+/g, ''), kind: f.kind,
    percentOff: f.kind === 'percent' ? n : null, amountOffMinor: f.kind === 'fixed' ? Math.round(n * 100) : null, freeMonths: f.kind === 'free_months' ? n : null,
    appliesTo: f.allPlans ? null : f.plans, maxRedemptions: limit, validFrom: toIso(f.from, false), validUntil: toIso(f.until, true),
    active: f.active, note: f.note.trim() || null,
  };
}

function Form({ editing, onCancel, onSaved }: { editing: NonNullable<Editing>; onCancel: () => void; onSaved: (message: string) => void }) {
  const { t, pick } = useLang();
  const auth = useAuth();
  const original = editing.mode === 'edit' ? editing.coupon : null;
  const [f, setF] = useState<FormState>(() => stateOf(original));
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const locked = (original?.redemptions ?? 0) > 0;
  const fields = fieldsOf(f);
  const before = original ? fieldsOf(stateOf(original)) : null;
  const changes = fields && before ? Object.fromEntries(Object.entries(fields).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(before[k as keyof AdminCouponFields]))) : fields;
  const ready = !!fields && !!changes && Object.keys(changes).length > 0 && f.reason.trim().length >= 5 && (f.allPlans || f.plans.length > 0);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready || !fields) return;
    setBusy(true); setProblem(null);
    try {
      const result = original
        ? await auth.admin.updateCoupon(original.id, { ...changes, reason: f.reason.trim() })
        : await auth.admin.createCoupon({ ...fields, reason: f.reason.trim() });
      onSaved(original ? t(`حُفظ الكوبون ${result.code}.`, `Saved ${result.code}.`) : t(`أُنشئ الكوبون ${result.code}.`, `Created ${result.code}.`));
    } catch (err) {
      setProblem((err as Error).message);
      setBusy(false);
    }
  };
  const set = (patch: Partial<FormState>) => setF({ ...f, ...patch });
  const valueLabel = f.kind === 'percent' ? t('النسبة (%)', 'Percent off') : f.kind === 'fixed' ? t('المبلغ (ر.س)', 'Amount off (SAR)') : t('عدد الأشهر', 'Free months');

  return (
    <Panel title={original ? t(`تعديل ${original.code}`, `Edit ${original.code}`) : t('كوبون جديد', 'New coupon')}
      sub={locked ? t(`استخدمه ${original!.redemptions} متجر: الرمز والنوع والقيمة ثابتة الآن.`, `Used by ${original!.redemptions} store${original!.redemptions === 1 ? '' : 's'}: its code, kind and value are now fixed.`) : undefined}>
      <form onSubmit={save} noValidate>
        <div className="coupon-grid">
          <div className="field">
            <label htmlFor="c-code">{t('الرمز', 'Code')}</label>
            <input id="c-code" dir="ltr" value={f.code} disabled={locked} onChange={(e) => set({ code: e.target.value })} maxLength={32} placeholder="LAUNCH20" />
          </div>
          <div className="field">
            <label htmlFor="c-kind">{t('النوع', 'Kind')}</label>
            <select id="c-kind" value={f.kind} disabled={locked} onChange={(e) => set({ kind: e.target.value as FormState['kind'], value: '' })}>
              <option value="percent">{t('نسبة', 'Percent')}</option>
              <option value="fixed">{t('مبلغ ثابت', 'Fixed amount')}</option>
              <option value="free_months">{t('أشهر مجانية (شهري فقط)', 'Free months (monthly only)')}</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="c-value">{valueLabel}</label>
            <input id="c-value" dir="ltr" inputMode="decimal" value={f.value} disabled={locked} onChange={(e) => set({ value: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="c-limit">{t('حد الاستخدام (فارغ = بلا حد)', 'Use limit (blank = none)')}</label>
            <input id="c-limit" dir="ltr" inputMode="numeric" value={f.limit} onChange={(e) => set({ limit: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="c-from">{t('يبدأ (بتوقيت الرياض)', 'Starts (Riyadh)')}</label>
            <input id="c-from" type="date" value={f.from} onChange={(e) => set({ from: e.target.value })} />
          </div>
          <div className="field">
            <label htmlFor="c-until">{t('آخر يوم', 'Last day')}</label>
            <input id="c-until" type="date" value={f.until} onChange={(e) => set({ until: e.target.value })} />
          </div>
        </div>
        <fieldset className="coupon-plans">
          <legend>{t('الباقات', 'Plans')}</legend>
          <label className="toggle"><input type="checkbox" checked={f.allPlans} onChange={(e) => set({ allPlans: e.target.checked })} /><span>{t('كل الباقات', 'Every plan')}</span></label>
          {!f.allPlans && PLANS.map((p) => (
            <label className="toggle" key={p.code}>
              <input type="checkbox" checked={f.plans.includes(p.code)} onChange={(e) => set({ plans: e.target.checked ? [...f.plans, p.code] : f.plans.filter((x) => x !== p.code) })} />
              <span>{pick(p.name)}</span>
            </label>
          ))}
        </fieldset>
        <div className="coupon-grid">
          <div className="field"><label htmlFor="c-note">{t('ملاحظة داخلية', 'Internal note')}</label><input id="c-note" value={f.note} onChange={(e) => set({ note: e.target.value })} maxLength={500} /></div>
          <div className="field"><label className="toggle" style={{ marginTop: 26 }}><input type="checkbox" checked={f.active} onChange={(e) => set({ active: e.target.checked })} /><span>{t('فعّال', 'On')}</span></label></div>
        </div>
        <div className="admin-actions" style={{ marginTop: 6 }}>
          <div className="field act-reason">
            <label htmlFor="c-reason">{t('السبب', 'Reason')}</label>
            <input id="c-reason" value={f.reason} onChange={(e) => set({ reason: e.target.value })} maxLength={500} placeholder={t('مثال: حملة أكتوبر', 'e.g. October campaign')} />
          </div>
          <div className="btn-row">
            <button type="button" className="btn btn-ghost" onClick={onCancel}>{t('إلغاء', 'Cancel')}</button>
            <button type="submit" className="btn btn-accent" disabled={busy || !ready}>{busy ? t('جارٍ الحفظ…', 'Saving…') : original ? t('احفظ', 'Save') : t('أنشئ', 'Create')}</button>
          </div>
        </div>
        {!fields && f.value !== '' && <p className="field-error" style={{ margin: '8px 0 0' }}>{t('القيمة أو الحد ليس رقمًا صالحًا.', 'The value or the limit is not a valid number.')}</p>}
        {problem && <p className="field-error" role="alert" style={{ margin: '8px 0 0' }}>{t('لم يُحفظ: ', 'Not saved: ')}<span dir="ltr">{problem}</span></p>}
      </form>
    </Panel>
  );
}
