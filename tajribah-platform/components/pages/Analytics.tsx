'use client';

// MD-120 — Analytics

import { useState } from 'react';
import { Download, Info, Smartphone } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { useResource } from '@/lib/data';
import { formatNumber, formatPercent } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { Shell } from '@/components/dashboard/chrome';
import { ErrorNote, Funnel, Loading, MiniChart, PageHead, Panel, Stat } from '@/components/dashboard/ui';

const RANGES = ['7d', '30d', '90d'] as const;

export default function Analytics() {
  const { t, lang } = useLang();
  const [range, setRange] = useState<(typeof RANGES)[number]>('30d');
  const { data, loading, error } = useResource((source) => source.analytics(range), [range]);

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
            <button type="button" className="btn btn-ghost">
              <Download size={16} aria-hidden />{t('تصدير CSV', 'Export CSV')}
            </button>
          </>
        }
      />

      {loading && <Panel><Loading rows={6} /></Panel>}
      {error && <ErrorNote error={error} />}

      {!loading && data && (
        <>
          <div className="grid grid-4">
            <Stat
              label={t('ارتفاع التحويل', 'Conversion uplift')}
              value={data.totals.upliftPct == null ? null : `+${(data.totals.upliftPct * 100).toFixed(1)}%`}
              sub={t('من فتح العرض مقابل من لم يفتحه', 'Opened AR vs did not')}
            />
            <Stat
              label={t('تغيّر الإرجاع', 'Return rate change')}
              value={data.totals.returnDeltaPct == null ? null : formatPercent(data.totals.returnDeltaPct, lang)}
              sub={t('انخفاض الإرجاع للمنتجات المعروضة', 'On products with AR enabled')}
            />
            <Stat
              label={t('جلسات العرض', 'AR sessions')}
              value={formatNumber(data.totals.arSessions, lang)}
              sub={t(`من ${formatNumber(data.totals.views, lang)} مشاهدة`, `from ${formatNumber(data.totals.views, lang)} views`)}
            />
            <Stat
              label={t('الإيراد المرتبط', 'Attributed revenue')}
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
                              ? <span title={t('لا توجد بيانات كافية لهذا المنتج بعد', 'Not enough data for this product yet')}>—</span>
                              : <span style={{ color: 'var(--ok)' }}>+{(product.upliftPct * 100).toFixed(1)}%</span>}
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
                      <i style={{ width: `${(row.sessions / Math.max(1, data.byDevice[0].sessions)) * 100}%` }} />
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
