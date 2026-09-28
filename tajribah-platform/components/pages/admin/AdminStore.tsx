'use client';

// ADM-04 — Tenant detail: profile · ADM-05 usage & quotas · ADM-06 billing · ADM-07 connections (A3) · ADM-08 actions (A4)

import { useEffect, useState } from 'react';
import { AppLink, useEnv } from '@/lib/app-env';
import { useAuth, type AdminStoreAction, type AdminStoreDetail, type AdminTrailEntry } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { planByCode } from '@/lib/plans';
import { AdminShell } from '@/components/admin/shell';
import { Badge, Empty, ErrorNote, Loading, Meter, Panel } from '@/components/dashboard/ui';
import { ROLE_LABEL } from '@/components/pages/Team';
import { TrailTable } from '@/components/admin/trail';
import { STATUS_LABEL } from './AdminStores';

export default function AdminStore() {
  const { t } = useLang();
  return <AdminShell title={t('متجر', 'Store')}><Detail /></AdminShell>;
}

function Detail() {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  const env = useEnv();
  const id = env.path.split('/').filter(Boolean).pop() ?? '';
  const [data, setData] = useState<{ id: string; detail: AdminStoreDetail } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let live = true;
    auth.admin.store(id).then((detail) => { if (live) setData({ id, detail }); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, id, version]);

  if (error) return <ErrorNote error={error} />;
  if (!data || data.id !== id) return <Panel><Loading rows={5} /></Panel>;
  const { store, usage, credits, invoices, connections, members, staffTrail } = data.detail;
  return (
    <>
      <p style={{ marginTop: 0 }}><AppLink href="/admin/stores">{t('كل المتاجر', 'Every store')}</AppLink></p>
      <div className="grid grid-2">
        <Panel title={lang === 'ar' ? store.nameAr ?? store.name : store.name} sub={store.slug}>
          <dl className="facts">
            <dt>{t('الحالة', 'Status')}</dt>
            <dd>{pick(STATUS_LABEL[store.status])}{store.readOnly && <> · <Badge tone="warn">{store.readOnly === 'trial_ended' ? t('انتهت التجربة', 'Trial ended') : t('انتهى الاشتراك', 'Subscription ended')}</Badge></>}</dd>
            <dt>{t('الباقة', 'Plan')}</dt><dd>{pick(planByCode(store.plan).name)}{store.subscription ? ` · ${store.subscription}` : ` · ${t('بلا اشتراك', 'no subscription')}`}</dd>
            <dt>{t('نهاية التجربة', 'Trial ends')}</dt><dd>{store.trialEndsAt ? formatDate(store.trialEndsAt, lang) : '—'}</dd>
            <dt>{t('السجل التجاري', 'CR')}</dt><dd dir="ltr" className="mm">{store.crNumber ?? '—'}</dd>
            <dt>{t('الرقم الضريبي', 'VAT')}</dt><dd dir="ltr" className="mm">{store.vatNumber ?? '—'}</dd>
            <dt>{t('المدينة', 'City')}</dt><dd>{store.city ?? '—'}</dd>
            <dt>{t('أُنشئ', 'Created')}</dt><dd>{formatDate(store.createdAt, lang)}</dd>
            <dt>{t('في متجره', 'On its shop')}</dt>
            <dd>{data.detail.publishing.firstAt
              ? t(`أول نشر ${formatDate(data.detail.publishing.firstAt, lang)} · ${data.detail.publishing.live} منشور الآن`, `First published ${formatDate(data.detail.publishing.firstAt, lang)} · ${data.detail.publishing.live} live now`)
              : t('لم يُنشر أي زر بعد', 'Nothing published yet')}</dd>
            <dt>{t('المعرّف', 'Id')}</dt><dd dir="ltr" className="mm">{store.id}</dd>
          </dl>
        </Panel>
        <Panel title={t('الاستهلاك مقابل الباقة', 'Usage against the plan')} sub={t(`رصيد الذكاء الاصطناعي: ${credits.balance}`, `AI credit balance: ${credits.balance}`)}>
          <Meter label={t('المنتجات', 'Products')} used={usage.products.used} limit={usage.products.limit} />
          <Meter label={t('أعضاء الفريق', 'Team members')} used={usage.team_members.used} limit={usage.team_members.limit} />
          <Meter label={t('التخزين (GB)', 'Storage (GB)')} used={Math.round(usage.storage_gb.used * 100) / 100} limit={usage.storage_gb.limit} />
          <Meter label={t('جلسات العرض هذا الشهر', 'AR sessions this month')} used={usage.ar_sessions.used} limit={usage.ar_sessions.limit} />
          <Meter label={t('أرصدة الذكاء الاصطناعي هذا الشهر', 'AI credits this month')} used={usage.ai_credits.used} limit={usage.ai_credits.limit} />
        </Panel>
      </div>
      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <Panel flush title={t('الفواتير', 'Invoices')}>
          {invoices.length === 0 ? <Empty title={t('لا فواتير', 'No invoices')} body={t('لم تصدر فاتورة لهذا المتجر بعد.', 'No invoice has been issued to this store yet.')} /> : (
            <div className="table-wrap"><table className="data"><tbody>
              {invoices.map((i) => <tr key={i.id}><td className="mm" dir="ltr">{i.number}</td><td>{formatDate(i.issuedAt, lang)}</td><td className="num">{formatMoney(i.totalMinor, i.currency, lang)}</td><td>{i.status}</td></tr>)}
            </tbody></table></div>
          )}
        </Panel>
        <Panel flush title={t('ربط المتجر', 'Store connections')}>
          {connections.length === 0 ? <Empty title={t('لا اتصال', 'Not connected')} body={t('لم يُربط متجر إلكتروني بعد.', 'No online store connected yet.')} /> : (
            <div className="table-wrap"><table className="data"><tbody>
              {connections.map((c) => <tr key={c.id}><td>{c.provider}</td><td>{c.storeName ?? c.storeUrl ?? '—'}</td><td>{c.status}</td><td>{c.lastSyncAt ? formatDateTime(c.lastSyncAt, lang) : '—'}</td></tr>)}
            </tbody></table></div>
          )}
        </Panel>
      </div>
      <div style={{ marginTop: 18 }}><ViewAsStore storeId={store.id} /></div>
      <div style={{ marginTop: 18 }}><Actions store={store} onDone={() => setVersion((v) => v + 1)} /></div>
      <div style={{ marginTop: 18 }}><Activity storeId={store.id} version={version} /></div>
      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <Panel flush title={t('الفريق', 'Team')}>
          <div className="table-wrap"><table className="data"><tbody>
            {members.map((m) => <tr key={m.id}><td>{m.fullName || '—'}</td><td dir="ltr">{m.email}</td><td>{pick(ROLE_LABEL[m.role])}</td><td>{m.status}</td></tr>)}
          </tbody></table></div>
        </Panel>
        <Panel flush title={t('ما فعله الموظفون في هذا المتجر', 'Staff actions on this store')}>
          {staffTrail.length === 0 ? <Empty title={t('لا شيء', 'None')} body={t('لم يُجرِ أي موظف تغييرًا على هذا المتجر.', 'No staff member has changed this store.')} /> : (
            <div className="table-wrap"><table className="data"><tbody>
              {staffTrail.map((r) => <tr key={r.id}><td>{formatDateTime(r.at, lang)}</td><td dir="ltr">{r.staff}</td><td className="mm" dir="ltr">{r.action}</td><td>{r.reason ?? '—'}</td></tr>)}
            </tbody></table></div>
          )}
        </Panel>
      </div>
    </>
  );
}

/** A4b — see the dashboard exactly as the store does, read-only, for a limited time. */
function ViewAsStore({ storeId }: { storeId: string }) {
  const { t } = useLang();
  const auth = useAuth();
  const env = useEnv();
  const [minutes, setMinutes] = useState(30);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reason.trim().length < 5) return;
    setBusy(true); setProblem(null);
    try { await auth.admin.viewStore(storeId, minutes, reason.trim()); env.navigate('/dashboard'); }
    catch (err) { setProblem((err as Error).message); setBusy(false); }
  };
  return (
    <Panel title={t('عرض لوحة المتجر', 'View as the store')} sub={t('ترى لوحة المتجر كما يراها، للاطلاع فقط ولمدة محددة. يُسجَّل في سجل نشاط المتجر.', 'See the store’s dashboard as it does — read-only, for a set time. Recorded in the store’s activity.')}>
      <form className="admin-actions" onSubmit={start} noValidate>
        <div className="field act-amount">
          <label htmlFor="view-minutes">{t('المدة', 'For')}</label>
          <select id="view-minutes" value={minutes} onChange={(e) => setMinutes(Number(e.target.value))}>
            {[15, 30, 60].map((m) => <option key={m} value={m}>{t(`${m} دقيقة`, `${m} minutes`)}</option>)}
          </select>
        </div>
        <div className="field act-reason">
          <label htmlFor="view-reason">{t('السبب', 'Reason')}</label>
          <input id="view-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={t('مثال: التاجر يقول إن منتجًا اختفى', 'e.g. merchant says a product disappeared')} />
        </div>
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" disabled={busy || reason.trim().length < 5}>{t('اعرض كالمتجر', 'View as the store')}</button>
        </div>
      </form>
      {problem && <p className="field-error" role="alert" style={{ margin: '8px 0 0' }}><span dir="ltr">{problem}</span></p>}
    </Panel>
  );
}

/** A12 — the store's own activity trail: what it did, and what was done to it. */
function Activity({ storeId, version }: { storeId: string; version: number }) {
  const { t } = useLang();
  const auth = useAuth();
  const [page, setPage] = useState<{ key: string; entries: AdminTrailEntry[]; next: string | null } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const key = `${storeId}:${version}`;
  useEffect(() => {
    let live = true;
    auth.admin.storeActivity(storeId).then((p) => { if (live) setPage({ key, ...p }); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, storeId, key]);
  const more = async () => {
    if (!page?.next) return;
    const p = await auth.admin.storeActivity(storeId, page.next);
    setPage({ key: page.key, entries: [...page.entries, ...p.entries], next: p.next });
  };
  const current = page?.key === key ? page : null;
  return (
    <Panel flush title={t('نشاط المتجر', 'Store activity')} sub={t('الأحدث أولًا — أسماء الحقول دون قيمها', 'Newest first — field names, not values')}>
      {error && <ErrorNote error={error} />}
      {!current && !error && <Loading rows={3} />}
      {current && current.entries.length === 0 && <Empty title={t('لا نشاط', 'No activity')} body={t('لم يُسجَّل شيء لهذا المتجر بعد.', 'Nothing has been recorded for this store yet.')} />}
      {current && current.entries.length > 0 && <TrailTable entries={current.entries} />}
      {current?.next && <div className="btn-row" style={{ padding: 16 }}><button type="button" className="btn btn-ghost" onClick={more}>{t('المزيد', 'Show more')}</button></div>}
    </Panel>
  );
}

type Kind = AdminStoreAction['type'];

/** The server's refusals (server/modules/admin/actions.ts, credits.ts), in Arabic; anything else as sent. */
const REFUSALS: Record<string, string> = {
  'only a store on its trial can have the trial extended': 'لا تُمدَّد التجربة إلا لمتجر في فترة تجربته',
  'the store is already suspended': 'المتجر موقوف بالفعل',
  'the store is not suspended': 'المتجر غير موقوف',
  'an adjustment cannot take the balance below zero': 'لا يمكن أن ينزل الرصيد تحت الصفر',
};

/** ADM-08 — what staff can change on a store. Every change needs a reason; the store sees it in its activity. */
function Actions({ store, onDone }: { store: AdminStoreDetail['store']; onDone: () => void }) {
  const { t, lang } = useLang();
  const auth = useAuth();
  const onTrial = store.status === 'trial' && store.subscription !== 'active' && store.subscription !== 'past_due';
  const kinds: { kind: Kind; label: string }[] = [
    ...(onTrial ? [{ kind: 'extend_trial' as const, label: t('تمديد التجربة', 'Extend the trial') }] : []),
    store.status === 'suspended'
      ? { kind: 'restore' as const, label: t('إعادة تفعيل المتجر', 'Restore the store') }
      : { kind: 'suspend' as const, label: t('إيقاف المتجر', 'Suspend the store') },
    { kind: 'adjust_credits', label: t('تعديل أرصدة الذكاء الاصطناعي', 'Adjust AI credits') },
  ];
  const [chosen, setChosen] = useState<Kind | null>(null);
  const kind = kinds.some((k) => k.kind === chosen) ? chosen! : kinds[0]!.kind;
  const [amount, setAmount] = useState('7');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const n = Number(amount);
  const amountProblem = kind === 'extend_trial' ? (Number.isInteger(n) && n >= 1 && n <= 90 ? null : t('من 1 إلى 90 يومًا', '1 to 90 days'))
    : kind === 'adjust_credits' ? (Number.isInteger(n) && n !== 0 ? null : t('عدد صحيح غير صفري؛ السالب يخصم', 'A whole, non-zero number; negative takes credits away'))
    : null;
  const reasonProblem = reason.trim().length < 5 ? t('اكتب السبب ببضع كلمات', 'Say why, in a few words') : null;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (amountProblem || reasonProblem) return;
    const action: AdminStoreAction = kind === 'extend_trial' ? { type: kind, days: n, reason: reason.trim() }
      : kind === 'adjust_credits' ? { type: kind, delta: n, reason: reason.trim() }
      : { type: kind, reason: reason.trim() };
    setBusy(true); setProblem(null); setDone(null);
    try {
      await auth.admin.act(store.id, action);
      setDone(kinds.find((k) => k.kind === kind)!.label);
      setReason('');
      onDone();
    } catch (err) {
      setProblem((err as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <Panel title={t('إجراءات على المتجر', 'Act on this store')} sub={t('يُسجَّل كل إجراء مع سببه، ويراه المتجر في سجل نشاطه.', 'Every action is recorded with its reason, and the store sees it in its activity.')}>
      <form className="admin-actions" onSubmit={submit} noValidate>
        <div className="field">
          <label htmlFor="act-kind">{t('الإجراء', 'Action')}</label>
          <select id="act-kind" value={kind} onChange={(e) => { setChosen(e.target.value as Kind); setAmount(e.target.value === 'adjust_credits' ? '' : '7'); setDone(null); }}>
            {kinds.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
          </select>
        </div>
        {(kind === 'extend_trial' || kind === 'adjust_credits') && (
          <div className="field act-amount">
            <label htmlFor="act-amount">{kind === 'extend_trial' ? t('عدد الأيام', 'Days') : t('الأرصدة (+ أو −)', 'Credits (+ or −)')}</label>
            <input id="act-amount" dir="ltr" inputMode="numeric" value={amount} onChange={(e) => setAmount(e.target.value)} aria-invalid={!!amountProblem && amount !== ''} />
            {amountProblem && amount !== '' && <span className="field-error">{amountProblem}</span>}
          </div>
        )}
        <div className="field act-reason">
          <label htmlFor="act-reason">{t('السبب', 'Reason')}</label>
          <input id="act-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={t('مثال: تأخر الإطلاق بسبب المنصة', 'e.g. launch delayed on our side')} />
        </div>
        <div className="btn-row">
          <button type="submit" className={kind === 'suspend' ? 'btn btn-danger' : 'btn btn-accent'} disabled={busy || !!amountProblem || !!reasonProblem}>
            {busy ? t('جارٍ التنفيذ…', 'Working…') : kinds.find((k) => k.kind === kind)!.label}
          </button>
        </div>
      </form>
      {problem && <p className="field-error" role="alert" style={{ margin: '8px 0 0' }}>{t('لم يُنفَّذ: ', 'Not done: ')}{lang === 'ar' && REFUSALS[problem] ? REFUSALS[problem] : <span dir="ltr">{problem}</span>}</p>}
      {done && <p role="status" style={{ color: 'var(--ok)', margin: '8px 0 0' }}>{t(`تم: ${done}`, `Done: ${done}`)}</p>}
    </Panel>
  );
}
