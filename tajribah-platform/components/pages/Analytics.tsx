'use client';

// MD-120 — Analytics

import { useState } from 'react';
import { Download, Info, Smartphone } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { useData, useResource } from '@/lib/data';
import { currentStore } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { formatNumber, formatPercent, formatPoints } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { Shell } from '@/components/dashboard/chrome';
import { ErrorNote, Funnel, Loading, MiniChart, PageHead, Panel, Stat } from '@/components/dashboard/ui';

const RANGES = ['7d', '30d', '90d'] as const;

export default function Analytics() {
  const { t, lang } = useLang();
  const [range, setRange] = useState<(typeof RANGES)[number]>('30d');
  const { data, loading, error } = useResource((source) => source.analytics(range), [range]);
  const source = useData();
  const auth = useAuth();
  // P4.8: exporting takes the data away, so it follows `analytics:export` (viewers can only look).
  const role = currentStore(auth.me)?.role;
  const canExport = !!role && (ROLE_PERMISSIONS[role] as readonly string[]).includes('analytics:export');
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<Error | null>(null);
  const exportCsv = async () => {
    setExporting(true); setExportError(null);
    try {
      const csv = await source.analyticsCsv(range);
      const url = URL.createObjectURL(new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' }));
      const a = document.createElement('a');
      a.href = url; a.download = `tajribah-analytics-${range}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setExportError(e as Error); } finally { setExporting(false); }
  };

  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('التحليلات', 'Analytics') },
  ];

  const rangeLabel = (value: (typeof RANGES)[number]) =>
    value === '7d' ? t('7 أيام', '7 days') : value === '30d' ? t('30 يومًا', '30 days') : t('90 يومًا', '90 days');

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('التحليلات', 'Analytics')}
        lead={t(
          'رقمان يستحقان الاشتراك: كم زاد التحويل عند من جرّب المنتج، وكم انخفض الإرجاع. البقية سياق لهما.',
          'Two numbers justify the subscription: how much conversion rose for shoppers who tried the product, and how much returns fell. The rest is context.',
        )}
        actions={
          <>
            <div style={{ display: 'flex', gap: 4 }}>
              {RANGES.map((value) => (
                <button
                  key={value}
                  type="button"
                  className={`btn btn-sm ${range === value ? 'btn-primary' : 'btn-ghost'}`}
                  onClick={() => setRange(value)}
                >
                  {rangeLabel(value)}
                </button>
              ))}
            </div>
            <button type="button" className="btn btn-ghost" onClick={exportCsv} disabled={!canExport || exporting}
              title={canExport ? undefined : t('التصدير للمالك والمسؤول والمحلّل', 'Export is for owners, admins and analysts')}>
              <Download size={16} aria-hidden />{exporting ? t('جارٍ التصدير…', 'Exporting…') : t('تصدير CSV', 'Export CSV')}
            </button>
          </>
        }
      />

      {loading && <Panel><Loading rows={6} /></Panel>}
      {error && <ErrorNote error={error} />}
      {exportError && <ErrorNote error={exportError} />}

      {!loading && data && data.totals.views === 0 && data.series.every((p) => p.views === 0) && (
        <Panel>
          <p style={{ margin: 0 }}>
            <Info size={15} aria-hidden style={{ verticalAlign: -2 }} />{' '}
            {t('لا توجد بيانات بعد. تبدأ الأرقام بالظهور بعد تركيب الزر في متجرك وزيارة المتسوّقين لصفحات منتجاتك — وتُحدَّث يوميًا.',
              'No data yet. Numbers start to appear once the button is installed in your store and shoppers visit your product pages — updated daily.')}
          </p>
        </Panel>
      )}

      {!loading && data && (
        <>
          <div className="grid grid-4" style={{ marginTop: data.totals.views === 0 ? 18 : 0 }}>
            <Stat
              label={t('ارتفاع التحويل', 'Conversion uplift')}
              value={data.totals.upliftPct == null ? null : formatPoints(data.totals.upliftPct, lang)}
              sub={data.totals.upliftPct == null
                ? t('يظهر حين يبلغ كل من الفريقين 100 جلسة على الأقل', 'Shown once both groups reach 100 sessions')
                : t('نسبة الشراء لمن فتح العرض ناقص من لم يفتحه', 'Purchase rate with AR minus without')}
            />
            <Stat
              label={t('تغيّر الإرجاع', 'Return rate change')}
              value={data.totals.returnDeltaPct == null ? null : formatPercent(data.totals.returnDeltaPct, lang)}
              sub={data.totals.returnDeltaPct == null
                ? t('يحتاج بيانات الإرجاع من منصة متجرك', 'Needs return data from your store platform')
                : t('للمنتجات المعروضة مقابل غيرها', 'Products with AR versus the rest')}
            />
            <Stat
              label={t('جلسات العرض', 'AR sessions')}
              value={formatNumber(data.totals.arSessions, lang)}
              sub={t(`من ${formatNumber(data.totals.views, lang)} مشاهدة`, `from ${formatNumber(data.totals.views, lang)} views`)}
            />
            <Stat
              label={t('إيراد المشتريات المسجّلة', 'Tracked revenue')}
              value={formatMoney(data.totals.revenueMinor, 'SAR', lang, { compact: true })}
              sub={t(`${formatNumber(data.totals.purchases, lang)} عملية شراء`, `${formatNumber(data.totals.purchases, lang)} purchases`)}
            />
          </div>

          <div className="grid grid-main" style={{ marginTop: 18 }}>
            <div className="grid" style={{ gap: 18 }}>
              <Panel title={t('الحركة اليومية', 'Daily activity')}>
                <MiniChart
                  points={data.series}
                  labels={{ views: t('مشاهدات', 'Views'), ar: t('جلسات عرض', 'AR sessions') }}
                />
              </Panel>

              <Panel
                title={t('من المشاهدة إلى الشراء', 'From view to purchase')}
                sub={t('كل خطوة بالنسبة لعدد من وصلها', 'Each step, against how many reached it')}
              >
                <Funnel steps={data.funnel} />
              </Panel>

              <Panel flush title={t('أفضل المنتجات', 'Top products')}>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">{t('المنتج', 'Product')}</th>
                        <th scope="col">{t('مشاهدات', 'Views')}</th>
                        <th scope="col">{t('جلسات عرض', 'AR sessions')}</th>
                        <th scope="col">{t('شراء', 'Purchases')}</th>
                        <th scope="col">{t('ارتفاع التحويل', 'Uplift')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.topProducts.map((product) => (
                        <tr key={product.productId}>
                          <td><strong style={{ fontWeight: 600 }}>{product.name}</strong></td>
                          <td className="num">{formatNumber(product.views, lang)}</td>
                          <td className="num">{formatNumber(product.arSessions, lang)}</td>
                          <td className="num">{formatNumber(product.purchases, lang)}</td>
                          <td className="num">
                            {product.upliftPct == null
                              ? <span title={t('يظهر حين يبلغ كل من الفريقين 100 جلسة على هذا المنتج', 'Shown once both groups reach 100 sessions on this product')}>—</span>
                              : <span style={{ color: product.upliftPct < 0 ? 'var(--bad)' : 'var(--ok)' }}>{formatPoints(product.upliftPct, lang)}</span>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Panel>
            </div>

            <div className="grid" style={{ gap: 18 }}>
              <Panel title={t('الأجهزة', 'Devices')}>
                {data.byDevice.map((row) => (
                  <div className="usage-row" key={row.device}>
                    <div className="usage-top">
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                        <Smartphone size={14} aria-hidden />
                        {row.device === 'mobile' ? t('جوال', 'Mobile')
                          : row.device === 'tablet' ? t('لوحي', 'Tablet') : t('حاسب', 'Desktop')}
                      </span>
                      <span className="num">{formatNumber(row.sessions, lang)}</span>
                    </div>
                    <div className="meter">
                      <i style={{ width: `${(row.sessions / Math.max(1, ...data.byDevice.map((d) => d.sessions))) * 100}%` }} />
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text-3)' }}>
                      {t(
                        `${Math.round((row.arSupported / Math.max(1, row.sessions)) * 100)}% منها يدعم العرض`,
                        `${Math.round((row.arSupported / Math.max(1, row.sessions)) * 100)}% support AR`,
                      )}
                    </span>
                  </div>
                ))}
              </Panel>

              <Panel title={t('ماذا نقيس وماذا لا نقيس', 'What we measure, and what we do not')}>
                <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)' }}>
                  <Info size={14} aria-hidden style={{ verticalAlign: -2 }} />{' '}
                  {t(
                    'لا نحفظ عناوين IP ولا معرّفات تتبع بين المواقع ولا هوية المتسوّق. معرّف الجلسة يُجدَّد يوميًا، فلا يمكن تتبّع شخص عبر الأيام — وهذا مقصود.',
                    'We store no IP addresses, no cross-site identifiers and no shopper identity. The session id is rotated daily, so nobody can be followed across days — deliberately.',
                  )}
                </p>
                <p className="hint">
                  {t(
                    'الأحداث الخام تُحفظ 90 يومًا، والملخّصات اليومية تبقى.',
                    'Raw events are kept for 90 days; daily rollups are kept indefinitely.',
                  )}
                </p>
              </Panel>
            </div>
          </div>
        </>
      )}
    </Shell>
  );
}
