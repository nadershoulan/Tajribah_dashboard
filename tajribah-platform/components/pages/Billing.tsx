'use client';

// MD-160 — Subscription and invoices

import { CheckCircle2, CreditCard, FileText, Sparkles } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { useResource } from '@/lib/data';
import { formatDate, formatNumber, formatRelative } from '@/lib/format';
import { formatMoney, vatOf } from '@/lib/money';
import { PLANS, planByCode } from '@/lib/plans';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, Meter, PageHead, Panel } from '@/components/dashboard/ui';

export default function Billing() {
  const { t, pick, lang } = useLang();
  const { data, loading, error } = useResource((source) => source.billing());

  const crumbs = [
    { label: t('الرئيسية', 'Home'), href: '/dashboard' },
    { label: t('الاشتراك والفواتير', 'Billing') },
  ];

  const current = data ? planByCode(data.plan) : null;

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('الاشتراك والفواتير', 'Subscription and invoices')}
        lead={t(
          'الأسعار شهرية بالريال السعودي، وتُضاف ضريبة القيمة المضافة 15% عند الدفع. الفواتير متوافقة مع فاتورة (ZATCA).',
          'Prices are monthly in Saudi riyals; 15% VAT is added at checkout. Invoices are ZATCA-compliant.',
        )}
      />

      {loading && <Panel><Loading rows={5} /></Panel>}
      {error && <ErrorNote error={error} />}

      {!loading && data && current && (
        <>
          <Panel
            title={t('باقتك الحالية', 'Your plan')}
            actions={<button type="button" className="btn btn-ghost btn-sm">{t('قارن الباقات', 'Compare plans')}</button>}
          >
            <div style={{ display: 'flex', gap: 22, flexWrap: 'wrap', alignItems: 'flex-start' }}>
              <div style={{ flex: '1 1 260px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 6 }}>
                  <strong style={{ fontSize: 19 }}>{pick(current.name)}</strong>
                  {data.status === 'trialing' && <Badge tone="warn">{t('فترة تجريبية', 'Trial')}</Badge>}
                  {data.status === 'active' && <Badge tone="ok" dot>{t('نشط', 'Active')}</Badge>}
                  {data.status === 'past_due' && <Badge tone="bad">{t('دفعة متأخرة', 'Past due')}</Badge>}
                </div>
                <p style={{ margin: 0, color: 'var(--text-2)', fontSize: 14 }}>{pick(current.tagline)}</p>

                {data.status === 'trialing' && data.trialEndsAt && (
                  <p style={{ marginTop: 12, fontSize: 14 }}>
                    {t('تنتهي التجربة', 'Trial ends')} <strong>{formatRelative(data.trialEndsAt, lang)}</strong>
                    {' — '}{formatDate(data.trialEndsAt, lang)}
                  </p>
                )}

                {data.priceMinor != null && (
                  <p style={{ marginTop: 10, fontSize: 14, color: 'var(--text-2)' }}>
                    {formatMoney(data.priceMinor, data.currency, lang)} / {t('شهريًا', 'month')}
                    {' · '}
                    <span className="mm">
                      {t('ضريبة', 'VAT')} {formatMoney(vatOf(data.priceMinor), data.currency, lang)}
                    </span>
                  </p>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-accent">
                    {data.status === 'trialing' ? t('فعّل الاشتراك', 'Start your subscription') : t('غيّر الباقة', 'Change plan')}
                  </button>
                  <button type="button" className="btn btn-ghost">{t('الفوترة السنوية (شهران مجانًا)', 'Switch to annual (2 months free)')}</button>
                </div>
              </div>

              <div style={{ flex: '1 1 240px', minWidth: 220 }}>
                <Meter
                  label={t('أرصدة الذكاء الاصطناعي هذا الشهر', 'AI credits this month')}
                  used={data.aiCredits.usedThisPeriod}
                  limit={data.aiCredits.grantedThisPeriod}
                />
                <p className="hint" style={{ marginTop: 0 }}>
                  {t(
                    `الرصيد المتبقي ${formatNumber(data.aiCredits.balance, lang)}. كل توليد نموذج يستهلك رصيدًا واحدًا.`,
                    `${formatNumber(data.aiCredits.balance, lang)} credits left. One 3D generation uses one credit.`,
                  )}
                </p>
              </div>
            </div>
          </Panel>

          <div className="grid grid-2" style={{ marginTop: 18 }}>
            <Panel title={t('طريقة الدفع', 'Payment method')}>
              {data.paymentMethod ? (
                <p style={{ margin: 0 }}>
                  <CreditCard size={16} aria-hidden /> {data.paymentMethod.type.toUpperCase()} ···· {data.paymentMethod.last4}
                  <span className="hint"> {data.paymentMethod.expiry}</span>
                </p>
              ) : (
                <Empty
                  icon={<CreditCard size={22} />}
                  title={t('لا توجد طريقة دفع', 'No payment method')}
                  body={t(
                    'أضف مدى أو بطاقة أو Apple Pay أو STC Pay قبل انتهاء التجربة حتى لا يتوقف العرض في متجرك.',
                    'Add mada, a card, Apple Pay or STC Pay before the trial ends so AR keeps running in your store.',
                  )}
                  action={<button type="button" className="btn btn-accent">{t('أضف طريقة دفع', 'Add a payment method')}</button>}
                />
              )}
            </Panel>

            <Panel flush title={t('الفواتير', 'Invoices')}>
              {data.invoices.length === 0 ? (
                <Empty
                  icon={<FileText size={22} />}
                  title={t('لا فواتير بعد', 'No invoices yet')}
                  body={t(
                    'ستصدر أول فاتورة عند بدء الاشتراك. كل فاتورة تحمل رقم ضريبي ورمز فاتورة (ZATCA) ويمكن تنزيلها PDF.',
                    'Your first invoice is issued when the subscription starts. Each one carries a VAT number and a ZATCA QR, and downloads as a PDF.',
                  )}
                />
              ) : (
                <div className="table-wrap">
                  <table className="data">
                    <thead>
                      <tr>
                        <th scope="col">{t('الرقم', 'Number')}</th>
                        <th scope="col">{t('التاريخ', 'Date')}</th>
                        <th scope="col">{t('الإجمالي', 'Total')}</th>
                        <th scope="col">{t('الحالة', 'Status')}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.invoices.map((invoice) => (
                        <tr key={invoice.id}>
                          <td className="num"><AppLink href={`/dashboard/billing/invoices/${encodeURIComponent(invoice.id)}`}>{invoice.number}</AppLink></td>
                          <td>{invoice.issuedAt ? formatDate(invoice.issuedAt, lang) : '—'}</td>
                          <td className="num">{formatMoney(invoice.totalMinor, invoice.currency, lang)}</td>
                          <td>
                            {invoice.status === 'paid'
                              ? <Badge tone="ok">{t('مدفوعة', 'Paid')}</Badge>
                              : <Badge tone="warn">{t('مستحقة', 'Due')}</Badge>}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Panel>
          </div>

          <h2 style={{ fontSize: 19, margin: '26px 0 14px' }}>{t('الباقات', 'Plans')}</h2>
          <div className="grid grid-4">
            {PLANS.map((plan) => {
              const isCurrent = plan.code === data.plan;
              return (
                <section
                  className="panel"
                  key={plan.code}
                  style={{ padding: 18, borderColor: plan.featured ? 'var(--aqua)' : undefined }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                    <strong style={{ fontSize: 17 }}>{pick(plan.name)}</strong>
                    {plan.featured && <Badge tone="accent">{t('الأكثر اختيارًا', 'Most chosen')}</Badge>}
                    {isCurrent && <Badge tone="ok">{t('باقتك', 'Current')}</Badge>}
                  </div>
                  <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-3)', minHeight: 40 }}>
                    {pick(plan.tagline)}
                  </p>
                  <div style={{ fontSize: 24, fontWeight: 700, fontFamily: 'var(--f-display)' }}>
                    {plan.priceMonthlyMinor == null
                      ? t('تواصل معنا', 'Talk to us')
                      : formatMoney(plan.priceMonthlyMinor, 'SAR', lang, { compact: true })}
                    {plan.priceMonthlyMinor != null && (
                      <span style={{ fontSize: 13, fontWeight: 400, color: 'var(--text-3)' }}> / {t('شهريًا', 'month')}</span>
                    )}
                  </div>
                  <ul style={{ listStyle: 'none', margin: '14px 0 0', padding: 0, display: 'grid', gap: 7 }}>
                    {plan.highlights.map((line) => (
                      <li key={line.en} style={{ display: 'flex', gap: 7, fontSize: 13.5, color: 'var(--text-2)' }}>
                        <CheckCircle2 size={15} aria-hidden style={{ flex: '0 0 auto', marginTop: 3, color: 'var(--aqua)' }} />
                        {pick(line)}
                      </li>
                    ))}
                  </ul>
                  <button type="button" className={`btn ${plan.featured ? 'btn-accent' : 'btn-ghost'}`}
                    style={{ width: '100%', justifyContent: 'center', marginTop: 16 }} disabled={isCurrent}>
                    {isCurrent ? t('باقتك الحالية', 'Your plan')
                      : plan.priceMonthlyMinor == null ? t('تواصل معنا', 'Contact us')
                        : <><Sparkles size={15} aria-hidden />{t('اختر هذه', 'Choose this')}</>}
                  </button>
                </section>
              );
            })}
          </div>

          <p className="hint" style={{ marginTop: 14 }}>
            {t(
              'الأسعار لا تشمل ضريبة القيمة المضافة 15%. الفواتير تصدر باسم منشأتك ورقمها الضريبي كما أدخلتهما في الإعدادات.',
              'Prices exclude 15% VAT. Invoices are issued to the legal name and VAT number you entered in Settings.',
            )}
          </p>
        </>
      )}
    </Shell>
  );
}
