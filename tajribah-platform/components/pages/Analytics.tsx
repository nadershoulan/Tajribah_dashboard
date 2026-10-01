'use client';

// MD-120 — Analytics

import { useEffect, useState } from 'react';
import { Download, Info, Smartphone } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { useData, useResource } from '@/lib/data';
import type { AnalyticsView, LiveActivityView, ReportSubscriptionView, ShopEventType } from '@/lib/view-models';
import { currentStore } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { ROLE_PERMISSIONS } from '@/lib/permissions';
import { formatDate, formatNumber, formatPercent, formatPoints, formatRelative } from '@/lib/format';
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
            {data?.level === 'full' && <AppLink href="/dashboard/analytics/visits" className="btn btn-ghost">{t('الزيارات', 'Visits')}</AppLink>}
            <button type="button" className="btn btn-ghost" onClick={exportCsv} disabled={!canExport || exporting || data?.level === 'basic'}
              title={data?.level === 'basic' ? t('التصدير ضمن التحليلات الكاملة (باقة النمو فأعلى)', 'Export is part of full analytics (Growth and up)')
                : canExport ? undefined : t('التصدير للمالك والمسؤول والمحلّل', 'Export is for owners, admins and analysts')}>
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

              {data.level === 'basic' && (
                <Panel title={t('تقارير التحويل', 'Conversion reports')}>
                  <p style={{ margin: 0 }}>
                    {t('مقارنة من جرّب بمن لم يجرّب، ومسار المشاهدة إلى الشراء، وأفضل منتجاتك، وتصدير الأرقام — ضمن التحليلات الكاملة في باقة النمو فأعلى.',
                      'Tried versus did not, the path from view to purchase, your top products and exporting the figures are part of full analytics, in the Growth plan and up.')}{' '}
                    <AppLink href="/dashboard/billing">{t('الباقات', 'Plans')}</AppLink>
                  </p>
                </Panel>
              )}

              {data.level === 'full' && <UpliftPanel conversion={data.conversion} />}

              {data.level === 'full' && <Panel
                title={t('من المشاهدة إلى الشراء', 'From view to purchase')}
                sub={t('كل خطوة بالنسبة لعدد من وصلها', 'Each step, against how many reached it')}
              >
                <Funnel steps={data.funnel} />
              </Panel>}

              {data.level === 'full' && <Panel flush title={t('أفضل المنتجات', 'Top products')}>
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">{t('المنتج', 'Product')}</th>
                        <th scope="col">{t('مشاهدات', 'Views')}</th>
                        <th scope="col">{t('جلسات عرض', 'AR sessions')}</th>
                        <th scope="col">{t('تجارب افتراضية', 'Try-ons')}</th>
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
                          <td className="num">{formatNumber(product.tryonSessions, lang)}</td>
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
              </Panel>}
            </div>

            <div className="grid" style={{ gap: 18 }}>
              {data.level === 'full' && <LivePanel />}

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

              <WeeklyReportPanel />

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

const LIVE_EVERY_MS = 30_000;
const EVENT_LABEL: Record<ShopEventType, { ar: string; en: string }> = {
  product_view: { ar: 'مشاهدة منتج', en: 'Product view' },
  ar_open: { ar: 'فتح العرض', en: 'AR opened' },
  ar_place: { ar: 'وضع المنتج في المكان', en: 'Placed in the room' },
  ar_close: { ar: 'إغلاق العرض', en: 'AR closed' },
  tryon_start: { ar: 'بدء تجربة افتراضية', en: 'Try-on started' },
  tryon_capture: { ar: 'حفظ إطلالة', en: 'Look saved' },
  tryon_share: { ar: 'مشاركة إطلالة', en: 'Look shared' },
  add_to_cart: { ar: 'إضافة للسلة', en: 'Added to cart' },
  purchase: { ar: 'شراء', en: 'Purchase' },
};

/**
 * P4.9 — the shop right now: visits in the last five minutes, the last half hour minute by minute,
 * and the latest events. Asked again every half minute while the tab is in view; a failed refresh
 * keeps the last answer on screen and says so.
 */
function LivePanel() {
  const { t, lang } = useLang();
  const source = useData();
  const [view, setView] = useState<LiveActivityView | null>(null);
  const [failure, setFailure] = useState<Error | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') return;
      source.liveActivity().then((next) => { if (live) { setView(next); setFailure(null); } }).catch((e: Error) => { if (live) setFailure(e); });
    };
    load();
    const timer = setInterval(load, LIVE_EVERY_MS);
    document.addEventListener('visibilitychange', load);
    return () => { live = false; clearInterval(timer); document.removeEventListener('visibilitychange', load); };
  }, [source]);

  const peak = Math.max(1, ...(view?.minutes ?? []).map((m) => m.views + m.opens));
  const views = (view?.minutes ?? []).reduce((sum, m) => sum + m.views, 0);
  const device = (d: LiveActivityView['latest'][number]['device']) => (d === 'mobile' ? t('جوال', 'Mobile') : d === 'tablet' ? t('لوحي', 'Tablet') : d === 'desktop' ? t('حاسب', 'Desktop') : null);
  return (
    <Panel title={t('الآن في متجرك', 'In your shop right now')} sub={t('يتجدد كل نصف دقيقة', 'Refreshed every half minute')}>
      {!view && !failure && <Loading rows={2} />}
      {view && (
        <div data-live>
          <p style={{ margin: 0, display: 'flex', alignItems: 'baseline', gap: 8 }}>
            <strong className="num" style={{ fontSize: 30, lineHeight: 1 }}>{formatNumber(view.activeVisits, lang)}</strong>
            <span style={{ color: 'var(--text-2)' }}>{t('زيارة في آخر 5 دقائق', view.activeVisits === 1 ? 'visit in the last 5 minutes' : 'visits in the last 5 minutes')}</span>
          </p>
          <div role="img" aria-label={t(`${formatNumber(views, lang)} مشاهدة منتج في آخر 30 دقيقة`, `${formatNumber(views, lang)} product views in the last 30 minutes`)}
            style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 44, marginTop: 14 }} dir="ltr">
            {view.minutes.map((m) => (
              <i key={m.at} style={{ flex: 1, minWidth: 0, height: `${Math.max(4, ((m.views + m.opens) / peak) * 100)}%`, borderRadius: 2, background: m.views + m.opens ? 'var(--aqua)' : 'var(--tint)' }} />
            ))}
          </div>
          <p className="hint" style={{ marginTop: 6 }}>{t(`${formatNumber(views, lang)} مشاهدة منتج في آخر 30 دقيقة`, `${formatNumber(views, lang)} product views in the last 30 minutes`)}</p>
          {view.latest.length === 0
            ? <p className="hint">{t('لا نشاط في آخر نصف ساعة.', 'Nothing in the last half hour.')}</p>
            : (
              <ul style={{ listStyle: 'none', margin: '12px 0 0', padding: 0, display: 'grid', gap: 8, fontSize: 13.5 }}>
                {view.latest.map((e, i) => (
                  <li key={`${e.at}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                    <span style={{ minWidth: 0, flex: 1 }}>
                      <strong style={{ fontWeight: 600 }}>{EVENT_LABEL[e.type][lang]}</strong>
                      {e.product && <> · <bdi>{e.product}</bdi></>}
                      {[device(e.device), e.country].filter(Boolean).length > 0 && <span style={{ color: 'var(--text-3)' }}> · {[device(e.device), e.country].filter(Boolean).join(' · ')}</span>}
                    </span>
                    <span style={{ color: 'var(--text-3)', fontSize: 12.5, whiteSpace: 'nowrap' }}>{formatRelative(e.at, lang, new Date(view.asOf).getTime())}</span>
                  </li>
                ))}
              </ul>
            )}
        </div>
      )}
      {failure && <ErrorNote error={failure} />}
    </Panel>
  );
}

/**
 * P4.8 — the member's own weekly summary by email: a switch, where it goes and when. Each member
 * chooses for themselves; the reason is said when it cannot be turned on (role, plan, or an address
 * not yet confirmed), and when one that is on has stopped arriving.
 */
function WeeklyReportPanel() {
  const { t, lang } = useLang();
  const source = useData();
  const { data, error } = useResource((s) => s.reportSubscription(), []);
  const [changed, setChanged] = useState<ReportSubscriptionView | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<Error | null>(null);
  const view = changed ?? data;
  const toggle = async (weekly: boolean) => {
    setBusy(true); setFailure(null);
    try { setChanged(await source.setReportSubscription(weekly)); } catch (e) { setFailure(e as Error); } finally { setBusy(false); }
  };
  const why = view?.unavailable === 'role' ? t('الملخص لمن يملك صلاحية التصدير: المالك والمسؤول والمحلّل.', 'The summary is for those who may export: owners, admins and analysts.')
    : view?.unavailable === 'plan' ? t('الملخص الأسبوعي ضمن التحليلات الكاملة (باقة النمو فأعلى).', 'The weekly summary is part of full analytics (Growth and up).')
    : view?.unavailable === 'email' ? t('أكّد بريدك الإلكتروني أولاً — الملخص يُرسل إليه.', 'Confirm your email address first — the summary is sent to it.')
    : null;
  return (
    <Panel title={t('ملخص أسبوعي بالبريد', 'Weekly summary by email')}>
      <label className="toggle">
        <input type="checkbox" role="switch" checked={!!view?.weekly} disabled={!view || busy || (!!view.unavailable && !view.weekly)} onChange={(e) => void toggle(e.target.checked)} />
        <span>{t('أرسل لي أرقام الأسبوع كل أحد', 'Email me the week’s figures every Sunday')}</span>
      </label>
      {view && (
        <p className="hint" data-report-state={view.weekly ? (why ? 'paused' : 'on') : why ? 'unavailable' : 'off'}>
          {why
            ? <>{view.weekly && t('متوقف الآن. ', 'Paused for now. ')}{why}{view.unavailable === 'plan' && <>{' '}<AppLink href="/dashboard/billing">{t('الباقات', 'Plans')}</AppLink></>}</>
            : view.weekly
              ? <>{t('الملخص القادم إلى', 'The next one goes to')} <bdi dir="ltr">{view.email}</bdi> {t('صباح الأحد', 'on Sunday morning,')} {formatDate(`${view.nextOn}T12:00:00Z`, lang)}.</>
              : <>{t('أرقام الأسبوع من الأحد إلى السبت بجانب الأسبوع الذي قبله، إلى', 'The week’s figures, Sunday to Saturday, beside the week before, sent to')} <bdi dir="ltr">{view.email}</bdi>. {t('لك وحدك — كل عضو يختار لنفسه.', 'For you only — each member chooses for themselves.')}</>}
        </p>
      )}
      {(failure ?? error) && <ErrorNote error={(failure ?? error)!} />}
    </Panel>
  );
}

/**
 * P4.6 — the uplift with what it rests on: both groups, their sizes, whether the gap could be
 * chance, and the caveat a merchant needs before quoting it.
 */
function UpliftPanel({ conversion }: { conversion: AnalyticsView['conversion'] }) {
  const { t, lang } = useLang();
  const rate = (g: { sessions: number; purchases: number }) => (g.sessions ? formatPercent(g.purchases / g.sessions, lang) : '—');
  const verdict = conversion.verdict === 'likely-real'
    ? t('الفرق أكبر من أن يكون صدفة (بثقة 95%).', 'The gap is too large to be chance (95% confidence).')
    : conversion.verdict === 'could-be-chance'
      ? t('قد يكون الفرق صدفة — انتظر بيانات أكثر قبل الاعتماد عليه.', 'The gap could still be chance — wait for more data before relying on it.')
      : t('لا نعرض رقمًا حتى يبلغ كل من الفريقين 100 جلسة.', 'No figure until both groups reach 100 sessions.');
  return (
    <Panel title={t('من جرّب مقابل من لم يجرّب', 'Tried versus did not')} sub={t('نسبة الشراء في كل فريق، على المنتجات نفسها وفي الفترة نفسها', 'Purchase rate in each group, same products, same period')}>
      <div className="grid grid-2">
        <div>
          <p className="stat-label">{t('فتحوا العرض', 'Opened AR')}</p>
          <div className="stat-value">{rate(conversion.withAr)}</div>
          <div className="stat-sub">{t(`${formatNumber(conversion.withAr.purchases, lang)} شراء من ${formatNumber(conversion.withAr.sessions, lang)} جلسة`, `${formatNumber(conversion.withAr.purchases, lang)} purchases from ${formatNumber(conversion.withAr.sessions, lang)} sessions`)}</div>
        </div>
        <div>
          <p className="stat-label">{t('لم يفتحوه', 'Did not')}</p>
          <div className="stat-value">{rate(conversion.withoutAr)}</div>
          <div className="stat-sub">{t(`${formatNumber(conversion.withoutAr.purchases, lang)} شراء من ${formatNumber(conversion.withoutAr.sessions, lang)} جلسة`, `${formatNumber(conversion.withoutAr.purchases, lang)} purchases from ${formatNumber(conversion.withoutAr.sessions, lang)} sessions`)}</div>
        </div>
      </div>
      <p style={{ margin: '14px 0 0' }}>
        {conversion.upliftPct != null && <strong>{t('الفرق: ', 'Difference: ')}{formatPoints(conversion.upliftPct, lang)}. </strong>}
        {verdict}
      </p>
      <p className="hint" style={{ margin: '8px 0 0' }}>
        {t('تنبيه: من يختار تجربة المنتج قد يكون أكثر اهتمامًا به من البداية. هذه مقارنة، لا دليل على أن العرض وحده سبب الشراء.',
          'Note: shoppers who choose to try a product may have been more interested to begin with. This is a comparison, not proof that AR alone caused the purchase.')}
      </p>
    </Panel>
  );
}
