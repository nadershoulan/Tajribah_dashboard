'use client';

// ADM-17 — Subscriptions · ADM-18 — Invoices, across every store (A7)

import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useAuth, type AdminInvoiceRow, type AdminSubscriptionRow } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { PLANS, planByCode } from '@/lib/plans';
import { AdminShell } from '@/components/admin/shell';
import { Badge, Empty, ErrorNote, Loading, Panel, Stat } from '@/components/dashboard/ui';
import { STATUS as INVOICE_STATUS } from '@/components/pages/InvoiceView';

const SUB_STATUS: Record<AdminSubscriptionRow['status'], { ar: string; en: string }> = {
  trialing: { ar: 'تجربة', en: 'Trialing' }, active: { ar: 'نشط', en: 'Active' }, past_due: { ar: 'دفعة متأخرة', en: 'Past due' },
  paused: { ar: 'موقوف مؤقتًا', en: 'Paused' }, cancelled: { ar: 'ملغى', en: 'Cancelled' }, expired: { ar: 'منتهٍ', en: 'Expired' },
};

export default function AdminBilling() {
  const { t } = useLang();
  const [tab, setTab] = useState<'subscriptions' | 'invoices'>('subscriptions');
  return (
    <AdminShell title={t('الاشتراكات والفواتير', 'Subscriptions and invoices')}>
      <div className="seg" role="tablist" aria-label={t('العرض', 'View')} style={{ marginBottom: 16 }}>
        <button type="button" role="tab" aria-selected={tab === 'subscriptions'} className={tab === 'subscriptions' ? 'on' : ''} onClick={() => setTab('subscriptions')}>{t('الاشتراكات', 'Subscriptions')}</button>
        <button type="button" role="tab" aria-selected={tab === 'invoices'} className={tab === 'invoices' ? 'on' : ''} onClick={() => setTab('invoices')}>{t('الفواتير', 'Invoices')}</button>
      </div>
      {tab === 'subscriptions' ? <Subscriptions /> : <Invoices />}
    </AdminShell>
  );
}

const storeName = (s: { name: string; nameAr: string | null }, lang: string) => (lang === 'ar' ? s.nameAr ?? s.name : s.name);

function Subscriptions() {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  const [query, setQuery] = useState({ status: '', plan: '', cycle: '' });
  const key = JSON.stringify(query);
  const [page, setPage] = useState<{ key: string; rows: AdminSubscriptionRow[]; next: string | null; byStatus: Partial<Record<AdminSubscriptionRow['status'], number>> } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let live = true;
    auth.admin.subscriptions(query).then((r) => { if (live) setPage({ key, rows: r.subscriptions, next: r.next, byStatus: r.byStatus }); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, key, query]);
  const more = async () => {
    if (!page?.next) return;
    const r = await auth.admin.subscriptions({ ...query, before: page.next });
    setPage({ ...page, rows: [...page.rows, ...r.subscriptions], next: r.next });
  };
  const current = page?.key === key ? page : null;
  const total = current ? Object.values(current.byStatus).reduce((a, b) => a + (b ?? 0), 0) : 0;

  return (
    <Panel flush title={t('الاشتراكات', 'Subscriptions')} sub={current ? t(`${total} اشتراك بهذه المرشحات`, `${total} with these filters`) : undefined}>
      <div className="admin-filters">
        <select value={query.status} onChange={(e) => setQuery({ ...query, status: e.target.value })} aria-label={t('الحالة', 'Status')}>
          <option value="">{t('كل الحالات', 'Any status')}{current ? ` (${total})` : ''}</option>
          {Object.entries(SUB_STATUS).map(([value, label]) => <option key={value} value={value}>{pick(label)}{current ? ` (${current.byStatus[value as AdminSubscriptionRow['status']] ?? 0})` : ''}</option>)}
        </select>
        <select value={query.plan} onChange={(e) => setQuery({ ...query, plan: e.target.value })} aria-label={t('الباقة', 'Plan')}>
          <option value="">{t('كل الباقات', 'Any plan')}</option>
          {PLANS.map((p) => <option key={p.code} value={p.code}>{pick(p.name)}</option>)}
        </select>
        <select value={query.cycle} onChange={(e) => setQuery({ ...query, cycle: e.target.value })} aria-label={t('دورة الفوترة', 'Billing cycle')}>
          <option value="">{t('شهري وسنوي', 'Monthly and annual')}</option>
          <option value="monthly">{t('شهري', 'Monthly')}</option>
          <option value="annual">{t('سنوي', 'Annual')}</option>
        </select>
      </div>
      {error && <ErrorNote error={error} />}
      {!current && !error && <Loading rows={4} />}
      {current && current.rows.length === 0 && <Empty title={t('لا اشتراكات', 'No subscriptions')} body={t('لا اشتراك يطابق المرشحات. المتاجر في تجربتها بلا اشتراك لا تظهر هنا.', 'None match the filters. Stores on their trial without a subscription are not listed here.')} />}
      {current && current.rows.length > 0 && (
        <div className="table-wrap"><table className="data">
          <thead><tr>
            <th scope="col">{t('المتجر', 'Store')}</th><th scope="col">{t('الباقة', 'Plan')}</th><th scope="col">{t('الحالة', 'Status')}</th>
            <th scope="col" className="num">{t('سعر القائمة', 'List price')}</th><th scope="col">{t('نهاية الفترة', 'Period ends')}</th>
          </tr></thead>
          <tbody>
            {current.rows.map((s) => (
              <tr key={s.id}>
                <td className="cell-main"><AppLink href={`/admin/stores/${s.store.id}`}>{storeName(s.store, lang)}</AppLink><span className="lines"><span dir="ltr">{s.store.slug}</span></span></td>
                <td>{pick(planByCode(s.plan).name)} · {s.cycle === 'annual' ? t('سنوي', 'annual') : t('شهري', 'monthly')}</td>
                <td>
                  <Badge tone={s.status === 'active' ? 'ok' : s.status === 'trialing' ? 'accent' : s.status === 'past_due' ? 'warn' : 'bad'}>{pick(SUB_STATUS[s.status])}</Badge>
                  {s.cancelAtPeriodEnd && <> <Badge tone="warn">{t('يُلغى بنهاية الفترة', 'Ends at period end')}</Badge></>}
                </td>
                <td className="num">{s.listPriceMinor == null ? t('بالاتفاق', 'By agreement') : formatMoney(s.listPriceMinor, s.currency, lang)}</td>
                <td>{formatDate(s.currentPeriodEnd, lang)}</td>
              </tr>
            ))}
          </tbody>
        </table></div>
      )}
      {current?.next && <div className="btn-row" style={{ padding: 16 }}><button type="button" className="btn btn-ghost" onClick={more}>{t('المزيد', 'Show more')}</button></div>}
    </Panel>
  );
}

function Invoices() {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  const [q, setQ] = useState('');
  const [query, setQuery] = useState({ status: '', month: '', q: '' });
  const key = JSON.stringify(query);
  const [page, setPage] = useState<{ key: string; rows: AdminInvoiceRow[]; next: string | null; totals: { count: number; totalMinor: number; vatMinor: number } } | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    const timer = setTimeout(() => setQuery((current) => (current.q === q.trim() ? current : { ...current, q: q.trim() })), 250);
    return () => clearTimeout(timer);
  }, [q]);
  useEffect(() => {
    let live = true;
    auth.admin.invoices(query).then((r) => { if (live) setPage({ key, rows: r.invoices, next: r.next, totals: r.totals }); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, key, query]);
  const more = async () => {
    if (!page?.next) return;
    const r = await auth.admin.invoices({ ...query, before: page.next });
    setPage({ ...page, rows: [...page.rows, ...r.invoices], next: r.next });
  };
  const current = page?.key === key ? page : null;
  const currency = current?.rows[0]?.currency ?? 'SAR';

  return (
    <>
      {current && (
        <div className="grid grid-3" style={{ marginBottom: 16 }}>
          <Stat label={t('فواتير محتسبة', 'Invoices that count')} value={String(current.totals.count)} sub={t('مستحقة أو مدفوعة', 'Due or paid')} />
          <Stat label={t('الإجمالي شامل الضريبة', 'Total incl. VAT')} value={formatMoney(current.totals.totalMinor, currency, lang)} />
          <Stat label={t('ضريبة القيمة المضافة', 'VAT')} value={formatMoney(current.totals.vatMinor, currency, lang)} />
        </div>
      )}
      <Panel flush title={t('الفواتير', 'Invoices')} sub={t('الأحدث أولًا — الشهر بتوقيت الرياض', 'Newest first — months in Riyadh time')}>
        <div className="admin-filters">
          <label className="search">
            <Search size={15} aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} dir="ltr" placeholder={t('رقم الفاتورة', 'Invoice number')} aria-label={t('بحث', 'Search')} />
          </label>
          <select value={query.status} onChange={(e) => setQuery({ ...query, status: e.target.value })} aria-label={t('الحالة', 'Status')}>
            <option value="">{t('كل الحالات', 'Any status')}</option>
            {Object.entries(INVOICE_STATUS).map(([value, label]) => <option key={value} value={value}>{pick(label)}</option>)}
          </select>
          <input type="month" value={query.month} onChange={(e) => setQuery({ ...query, month: e.target.value })} aria-label={t('شهر الإصدار', 'Month issued')} />
        </div>
        {error && <ErrorNote error={error} />}
        {!current && !error && <Loading rows={4} />}
        {current && current.rows.length === 0 && <Empty title={t('لا فواتير', 'No invoices')} body={t('لا فاتورة تطابق المرشحات.', 'No invoice matches the filters.')} />}
        {current && current.rows.length > 0 && (
          <div className="table-wrap"><table className="data">
            <thead><tr>
              <th scope="col">{t('الرقم', 'Number')}</th><th scope="col">{t('المتجر', 'Store')}</th><th scope="col">{t('الحالة', 'Status')}</th>
              <th scope="col">{t('أُصدرت', 'Issued')}</th><th scope="col" className="num">{t('الإجمالي', 'Total')}</th>
            </tr></thead>
            <tbody>
              {current.rows.map((i) => (
                <tr key={i.id}>
                  <td className="mm" dir="ltr"><AppLink href={`/admin/invoices/${i.id}`}>{i.number}</AppLink></td>
                  <td><AppLink href={`/admin/stores/${i.store.id}`}>{storeName(i.store, lang)}</AppLink></td>
                  <td><Badge tone={i.status === 'paid' ? 'ok' : i.status === 'issued' ? 'warn' : i.status === 'draft' ? 'neutral' : 'bad'}>{pick(INVOICE_STATUS[i.status])}</Badge></td>
                  <td>{i.issuedAt ? formatDate(i.issuedAt, lang) : '—'}</td>
                  <td className="num">{formatMoney(i.totalMinor, i.currency, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
        {current?.next && <div className="btn-row" style={{ padding: 16 }}><button type="button" className="btn btn-ghost" onClick={more}>{t('المزيد', 'Show more')}</button></div>}
      </Panel>
    </>
  );
}
