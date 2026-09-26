'use client';

// ADM-04 — Tenant detail: profile · ADM-05 usage & quotas · ADM-06 billing · ADM-07 connections (A3)

import { useEffect, useState } from 'react';
import { AppLink, useEnv } from '@/lib/app-env';
import { useAuth, type AdminStoreDetail } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { formatMoney } from '@/lib/money';
import { planByCode } from '@/lib/plans';
import { AdminShell } from '@/components/admin/shell';
import { Badge, Empty, ErrorNote, Loading, Meter, Panel } from '@/components/dashboard/ui';
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
  useEffect(() => {
    let live = true;
    auth.admin.store(id).then((detail) => { if (live) setData({ id, detail }); }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin, id]);

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
      <div className="grid grid-2" style={{ marginTop: 18 }}>
        <Panel flush title={t('الفريق', 'Team')}>
          <div className="table-wrap"><table className="data"><tbody>
            {members.map((m) => <tr key={m.id}><td>{m.fullName || '—'}</td><td dir="ltr">{m.email}</td><td>{m.role}</td><td>{m.status}</td></tr>)}
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
