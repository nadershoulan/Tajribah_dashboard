'use client';

// MD-001 — Dashboard home

import { ArrowUpRight, Boxes, Package, Play, RefreshCw, Sparkles } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { useResource } from '@/lib/data';
import { formatDateTime, formatNumber, formatPoints, formatRelative } from '@/lib/format';
import { formatMoney } from '@/lib/money';
import { planByCode } from '@/lib/plans';
import { Shell } from '@/components/dashboard/chrome';
import {
  Badge, Empty, ErrorNote, Forward, Loading, Meter, MiniChart, PageHead, Panel, Stat,
} from '@/components/dashboard/ui';

export default function DashboardHome() {
  const { t, pick, lang } = useLang();
  const { data, loading, error } = useResource((source) => source.dashboard());

  const crumbs = [{ label: t('الرئيسية', 'Home') }];

  if (loading || !data) {
    return (
      <Shell tenant={null} crumbs={crumbs}>
        <PageHead title={t('الرئيسية', 'Home')} />
        <Panel><Loading rows={5} /></Panel>
      </Shell>
    );
  }
  if (error) {
    return <Shell tenant={null} crumbs={crumbs}><ErrorNote error={error} /></Shell>;
  }

  const { tenant, counts, usage, last30, series, connection, onboarding, activity } = data;
  const plan = planByCode(tenant.plan);
  // A skipped step is put off, not pending: it does not count as left to do.
  const remaining = onboarding.steps.filter((step) => !step.done && !step.skipped);

  return (
    <Shell tenant={tenant} crumbs={crumbs}>
      <PageHead
        title={t(`أهلًا، ${tenant.name}`, `Welcome, ${tenant.name}`)}
        lead={t(
          'هذه صورة آخر 30 يومًا من متجرك: كم شخصًا شاهد منتجاتك، وكم منهم جرّبها قبل الشراء.',
          'The last 30 days at a glance: how many people saw your products, and how many tried them before buying.',
        )}
        actions={
          <>
            <AppLink href="/dashboard/products" className="btn btn-ghost">
              <Package size={16} aria-hidden />{t('المنتجات', 'Products')}
            </AppLink>
            <AppLink href="/dashboard/models" className="btn btn-primary">
              <Sparkles size={16} aria-hidden />{t('أضف نموذجًا', 'Add a model')}
            </AppLink>
          </>
        }
      />

      {remaining.length > 0 && (
        <Panel
          flush
          title={t('لنكمل الإعداد', 'Finish setting up')}
          actions={<AppLink href="/dashboard/onboarding" className="btn btn-quiet btn-sm">{t('دليل الإعداد', 'Setup guide')}<Forward size={14} /></AppLink>}
          sub={t(
            `بقيت ${remaining.length} من ${onboarding.steps.length} خطوات — حوالي ${remaining.reduce((m, s) => m + s.minutes, 0)} دقيقة`,
            `${remaining.length} of ${onboarding.steps.length} steps left — about ${remaining.reduce((m, s) => m + s.minutes, 0)} minutes`,
          )}
        >
          <div className="steps">
            {onboarding.steps.map((step) => (
              <div className={`step${step.done ? ' done' : ''}`} key={step.key}>
                <span className="mark" aria-hidden>{step.done ? '✓' : ''}</span>
                <div className="step-body">
                  <strong>{pick(step.title)}</strong>
                  <p>{pick(step.description)}</p>
                </div>
                <div className="step-side">
                  {step.done
                    ? <Badge tone="ok">{t('تم', 'Done')}</Badge>
                    : step.skipped ? <Badge>{t('مؤجّلة', 'Skipped')}</Badge> : (
                      <>
                        <span className="minutes">{t(`${step.minutes} دقائق`, `${step.minutes} min`)}</span>
                        <AppLink href={step.href} className="btn btn-ghost btn-sm">
                          {t('ابدأ', 'Start')}<Forward size={14} />
                        </AppLink>
                      </>
                    )}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <div className="grid grid-4" style={{ marginTop: 18 }}>
        <Stat
          label={t('مشاهدات المنتجات', 'Product views')}
          value={formatNumber(last30.views, lang)}
          sub={t('آخر 30 يومًا', 'Last 30 days')}
        />
        <Stat
          label={t('جلسات العرض ثلاثي الأبعاد', 'AR sessions')}
          value={formatNumber(last30.arSessions, lang)}
          sub={t(
            `${Math.round((last30.arSessions / Math.max(1, last30.views)) * 100)}% ممن شاهدوا المنتج`,
            `${Math.round((last30.arSessions / Math.max(1, last30.views)) * 100)}% of viewers`,
          )}
        />
        <Stat
          label={t('ارتفاع نسبة التحويل', 'Conversion uplift')}
          value={last30.upliftPct == null ? null : formatPoints(last30.upliftPct, lang)}
          sub={t('مقارنة بمن لم يفتح العرض', 'Against shoppers who did not open AR')}
          hint={t(
            'نقارن نسبة الشراء لمن فتح العرض بنسبة من لم يفتحه، على المنتجات نفسها وفي الفترة نفسها.',
            'We compare the purchase rate of shoppers who opened AR with those who did not, on the same products over the same period.',
          )}
        />
        <Stat
          label={t('الإيراد المرتبط', 'Attributed revenue')}
          value={formatMoney(last30.revenueMinor, 'SAR', lang, { compact: true })}
          sub={t(`${formatNumber(last30.purchases, lang)} عملية شراء`, `${formatNumber(last30.purchases, lang)} purchases`)}
        />
      </div>

      <div className="grid grid-main" style={{ marginTop: 18 }}>
        <div className="grid" style={{ gap: 18 }}>
          <Panel
            title={t('الحركة اليومية', 'Daily activity')}
            sub={t('المشاهدات وما فُتح منها بالعرض ثلاثي الأبعاد', 'Views, and how many opened in AR')}
          >
            <MiniChart
              points={series}
              labels={{ views: t('مشاهدات', 'Views'), ar: t('جلسات عرض', 'AR sessions') }}
            />
          </Panel>

          <Panel
            flush
            title={t('آخر ما حدث', 'Recent activity')}
            actions={<AppLink href="/dashboard/analytics" className="btn btn-quiet btn-sm">
              {t('التحليلات', 'Analytics')}<Forward size={14} />
            </AppLink>}
          >
            {activity.length === 0 ? (
              <Empty title={t('لا يوجد نشاط بعد', 'Nothing yet')} body={t('سيظهر هنا كل ما يحدث في متجرك.', 'Everything that happens in your store shows up here.')} />
            ) : (
              <div className="activity">
                {activity.map((item) => (
                  <div className={`activity-item ${item.level}`} key={item.id}>
                    <span className="dot" aria-hidden />
                    <div>
                      <strong>{pick(item.title)}</strong>
                      {item.detail && <p>{pick(item.detail)}</p>}
                    </div>
                    <span className="when" title={formatDateTime(item.at, lang)}>
                      {formatRelative(item.at, lang)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        </div>

        <div className="grid" style={{ gap: 18 }}>
          <Panel
            title={t('متجرك', 'Your store')}
            actions={<AppLink href="/dashboard/connections" className="btn btn-quiet btn-sm">
              {t('إدارة', 'Manage')}
            </AppLink>}
          >
            {connection ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <strong>{connection.storeName}</strong>
                  <Badge tone={connection.status === 'active' ? 'ok' : 'bad'} dot>
                    {connection.status === 'active' ? t('متصل', 'Connected') : t('يحتاج انتباهك', 'Needs attention')}
                  </Badge>
                </div>
                <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 13.5 }}>
                  {t('سلة', 'Salla')} · {formatNumber(connection.productCount, lang)} {t('منتج', 'products')}
                  <br />
                  {connection.lastSyncAt && (
                    <>
                      <RefreshCw size={12} aria-hidden style={{ verticalAlign: -1 }} />{' '}
                      {t('آخر مزامنة', 'Last sync')} {formatRelative(connection.lastSyncAt, lang)}
                    </>
                  )}
                </p>
              </>
            ) : (
              <Empty
                icon={<Boxes size={22} />}
                title={t('لم يُربط متجر بعد', 'No store connected')}
                body={t('اربط سلة أو زد لاستيراد منتجاتك تلقائيًا.', 'Connect Salla or Zid to import your catalogue automatically.')}
                action={<AppLink href="/dashboard/connections" className="btn btn-accent">{t('اربط متجرك', 'Connect your store')}</AppLink>}
              />
            )}
          </Panel>

          <Panel
            title={t('استهلاك باقتك', 'Plan usage')}
            sub={t(`باقة ${pick(plan.name)}`, `${pick(plan.name)} plan`)}
            actions={<AppLink href="/dashboard/billing" className="btn btn-quiet btn-sm">
              {t('الاشتراك', 'Billing')}
            </AppLink>}
          >
            <Meter label={t('معروضة بثلاثي الأبعاد أو بالتجربة', 'Shown in 3D or try-on')} used={usage.products.used} limit={usage.products.limit} />
            <Meter label={t('جلسات العرض', 'AR sessions')} used={usage.arSessions.used} limit={usage.arSessions.limit} />
            <Meter label={t('أرصدة الذكاء الاصطناعي', 'AI credits')} used={usage.aiCredits.used} limit={usage.aiCredits.limit} />
            <Meter label={t('مساحة التخزين (GB)', 'Storage (GB)')} used={usage.storage.used} limit={usage.storage.limit} />
          </Panel>

          <Panel title={t('جاهزية المنتجات', 'Catalogue readiness')}>
            <p style={{ margin: '0 0 10px', fontSize: 14 }}>
              {t(
                `${formatNumber(counts.arEnabled, lang)} من ${formatNumber(counts.products, lang)} منتجًا عليها زر العرض`,
                `${formatNumber(counts.arEnabled, lang)} of ${formatNumber(counts.products, lang)} products have the AR button`,
              )}
            </p>
            <div className="meter"><i style={{ width: `${(counts.arEnabled / Math.max(1, counts.products)) * 100}%` }} /></div>
            <p className="hint">
              {t(
                `${formatNumber(counts.modelsReady, lang)} نموذجًا جاهزًا من ${formatNumber(counts.models, lang)}.`,
                `${formatNumber(counts.modelsReady, lang)} of ${formatNumber(counts.models, lang)} models are ready.`,
              )}
            </p>
            <AppLink href="/dashboard/products" className="btn btn-ghost btn-sm" style={{ marginTop: 12 }}>
              <Play size={14} aria-hidden />{t('أكمل الناقص', 'Fill the gaps')}
            </AppLink>
          </Panel>

          <Panel title={t('كيف تُقرأ الأرقام', 'How to read these numbers')}>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-2)' }}>
              {t(
                'ارتفاع التحويل ومعدل الإرجاع يحتاجان بيانات كافية قبل أن يكونا ذا معنى. إن لم تتوفر، نعرض «—» بدلًا من رقم لا يُعتمد عليه.',
                'Uplift and return rate need enough data before they mean anything. Until then we show “—” rather than a number you should not act on.',
              )}
            </p>
            <AppLink href="/dashboard/analytics" className="btn btn-quiet btn-sm" style={{ marginTop: 10 }}>
              {t('التفاصيل', 'See the detail')}<ArrowUpRight size={14} aria-hidden />
            </AppLink>
          </Panel>
        </div>
      </div>
    </Shell>
  );
}
