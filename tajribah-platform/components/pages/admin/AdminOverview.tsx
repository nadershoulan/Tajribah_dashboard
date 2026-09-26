'use client';

// ADM-02 — Admin overview (A2)

import { Fragment, useEffect, useState } from 'react';
import { useAuth, type PlatformOverview } from '@/lib/auth';
import { formatDateTime, formatNumber } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { PLANS } from '@/lib/plans';
import { AdminShell } from '@/components/admin/shell';
import { ErrorNote, Loading, Panel, Stat } from '@/components/dashboard/ui';

export default function AdminOverview() {
  const { t } = useLang();
  return <AdminShell title={t('نظرة عامة على المنصة', 'Platform overview')}><Figures /></AdminShell>;
}

function Figures() {
  const { t, pick, lang } = useLang();
  const auth = useAuth();
  const [data, setData] = useState<PlatformOverview | null>(null);
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let live = true;
    auth.admin.overview().then((d) => { if (live) setData(d); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin]);

  if (error) return <ErrorNote error={error} />;
  if (!data) return <Panel><Loading rows={4} /></Panel>;
  const n = (v: number) => formatNumber(v, lang);
  const money = (v: number) => formatMoney(v, 'SAR', lang);
  return (
    <>
      <div className="grid grid-4">
        <Stat label={t('المتاجر', 'Stores')} value={n(data.stores.total)} sub={t(`${n(data.newStores30d)} جديد خلال 30 يومًا`, `${n(data.newStores30d)} new in 30 days`)} />
        <Stat label={t('الإيراد الشهري المتكرر', 'MRR')} value={money(data.mrrMinor)} sub={t(`سنويًا ${money(data.arrMinor)}`, `ARR ${money(data.arrMinor)}`)}
          hint={t('بأسعار الباقات للاشتراكات النشطة والمتأخرة. لا يوجد تحصيل فعلي قبل ربط بوابة الدفع.', 'List prices of active and past-due subscriptions. No money is collected until the payment gateway is connected.')} />
        <Stat label={t('تجارب تنتهي خلال 7 أيام', 'Trials ending in 7 days')} value={n(data.trialsEndingIn7d)} sub={t(`${n(data.stores.readOnly)} متجر للاطلاع فقط`, `${n(data.stores.readOnly)} stores read-only`)} />
        <Stat label={t('إلغاءات خلال 30 يومًا', 'Cancellations, 30 days')} value={n(data.churn30d)} sub={t(`${n(data.invoicesThisMonth.count)} فاتورة هذا الشهر`, `${n(data.invoicesThisMonth.count)} invoices this month`)} />
      </div>
      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <Panel title={t('المتاجر حسب الحالة', 'Stores by status')}>
          <dl className="facts">
            <dt>{t('تجربة', 'Trial')}</dt><dd className="num">{n(data.stores.trial)}</dd>
            <dt>{t('نشط', 'Active')}</dt><dd className="num">{n(data.stores.active)}</dd>
            <dt>{t('دفعة متأخرة', 'Past due')}</dt><dd className="num">{n(data.stores.pastDue)}</dd>
            <dt>{t('موقوف', 'Suspended')}</dt><dd className="num">{n(data.stores.suspended)}</dd>
            <dt>{t('ملغى', 'Cancelled')}</dt><dd className="num">{n(data.stores.cancelled)}</dd>
          </dl>
        </Panel>
        <Panel title={t('الاشتراكات المدفوعة حسب الباقة', 'Paying subscriptions by plan')} sub={t(`أرصدة الذكاء الاصطناعي المستخدمة هذا الشهر: ${n(data.aiCreditsUsedThisMonth)}`, `AI credits used this month: ${n(data.aiCreditsUsedThisMonth)}`)}>
          <dl className="facts">
            {PLANS.map((plan) => <Fragment key={plan.code}><dt>{pick(plan.name)}</dt><dd className="num">{n(data.subscriptionsByPlan[plan.code])}</dd></Fragment>)}
          </dl>
        </Panel>
      </div>
      <p className="hint">{t('آخر تحديث', 'As of')} {formatDateTime(data.asOf, lang)}</p>
    </>
  );
}
