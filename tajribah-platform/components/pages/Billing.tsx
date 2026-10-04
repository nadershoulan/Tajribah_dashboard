'use client';

// MD-160 — Subscription and invoices · P2.10: checkout up to the payment step

import { CREDITS_PER_3D_GENERATION } from '@/lib/ai-credits';
import { useState } from 'react';
import { CheckCircle2, Clock, CreditCard, FileText, Lock, Mail, Phone, Sparkles, X } from 'lucide-react';
import { AppLink } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { useData, useResource, type CouponQuote } from '@/lib/data';
import { ApiError } from '@/lib/api-client';
import { formatDate, formatNumber, formatRelative } from '@/lib/format';
import { formatMoney, vatOf } from '@/lib/money';
import { PLANS, planByCode, type PlanCode } from '@/lib/plans';
import { priceInvoiceLines } from '@/lib/contracts/invoices';
import type { BillingSummary } from '@/lib/view-models';
import { CONTACT } from '@/lib/contact';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, Meter, PageHead, Panel } from '@/components/dashboard/ui';

export default function Billing() {
  const { t, pick, lang } = useLang();
  const { data, loading, error } = useResource((source) => source.billing());
  // P2.10: the plan and cycle being checked out, or null. Nothing is charged: payment opens with Moyasar (P2.3).
  const [checkout, setCheckout] = useState<{ plan: PlanCode; cycle: 'monthly' | 'annual' } | null>(null);
  const openCheckout = (plan: PlanCode, cycle: 'monthly' | 'annual') => {
    setCheckout({ plan, cycle });
    requestAnimationFrame(() => document.getElementById('checkout')?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

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
          'الأسعار شهرية بالريال السعودي، وتُضاف ضريبة القيمة المضافة 15% عند الدفع. كل فاتورة تُظهر الرقمين الضريبيين، ويُربط نظام الفوترة الإلكترونية (ZATCA) قبل أول عملية دفع.',
          'Prices are monthly in Saudi riyals; 15% VAT is added at checkout. Every invoice shows both VAT numbers; ZATCA e-invoicing is connected before the first charge.',
        )}
      />

      {loading && <Panel><Loading rows={5} /></Panel>}
      {error && <ErrorNote error={error} />}

      {!loading && data && current && (
        <>
          <Panel
            title={t('باقتك الحالية', 'Your plan')}
            actions={<button type="button" className="btn btn-ghost btn-sm" onClick={() => document.getElementById('plans')?.scrollIntoView({ behavior: 'smooth' })}>{t('قارن الباقات', 'Compare plans')}</button>}
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
                    {formatMoney(data.priceMinor, data.currency, lang)} / {data.cycle === 'annual' ? t('سنويًا', 'year') : t('شهريًا', 'month')}
                    {' · '}
                    <span className="mm">
                      {t('ضريبة', 'VAT')} {formatMoney(vatOf(data.priceMinor), data.currency, lang)}
                    </span>
                  </p>
                )}

                <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
                  <button type="button" className="btn btn-accent" onClick={() => openCheckout(data.plan, data.cycle)}>
                    {data.status === 'active' ? t('غيّر الباقة', 'Change plan') : t('فعّل الاشتراك', 'Start your subscription')}
                  </button>
                  {data.cycle !== 'annual' && (
                    <button type="button" className="btn btn-ghost" onClick={() => openCheckout(data.plan, 'annual')}>{t('الفوترة السنوية (شهران مجانًا)', 'Switch to annual (2 months free)')}</button>
                  )}
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
                    `الرصيد المتبقي ${formatNumber(data.aiCredits.balance, lang)}. كل توليد نموذج ثلاثي الأبعاد يستهلك ${formatNumber(CREDITS_PER_3D_GENERATION, lang)} أرصدة.`,
                    `${formatNumber(data.aiCredits.balance, lang)} credits left. One 3D generation uses ${CREDITS_PER_3D_GENERATION} credits.`,
                  )}{' '}
                  <AppLink href="/dashboard/ai-jobs" style={{ color: 'var(--aqua-ink)' }}>{t('أين ذهبت الأرصدة', 'Where they went')}</AppLink>
                </p>
              </div>
            </div>
          </Panel>

          {checkout && <Checkout data={data} plan={checkout.plan} cycle={checkout.cycle}
            onCycle={(cycle) => setCheckout({ ...checkout, cycle })} onClose={() => setCheckout(null)} />}

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
                    'ستتمكن من إضافة مدى أو بطاقة أو Apple Pay أو STC Pay عند ربط بوابة الدفع. بعد انتهاء التجربة دون باقة يصبح متجرك للاطلاع فقط.',
                    'You will be able to add mada, a card, Apple Pay or STC Pay once the payment gateway is connected. When a trial ends without a plan, the store becomes read-only.',
                  )}
                  action={<button type="button" className="btn btn-accent" disabled title={t('يتاح عند ربط بوابة الدفع', 'Available once the payment gateway is connected')}>{t('أضف طريقة دفع', 'Add a payment method')}</button>}
                />
              )}
            </Panel>

            <Panel flush title={t('الفواتير', 'Invoices')}>
              {data.invoices.length === 0 ? (
                <Empty
                  icon={<FileText size={22} />}
                  title={t('لا فواتير بعد', 'No invoices yet')}
                  body={t(
                    'ستصدر أول فاتورة عند بدء الاشتراك. كل فاتورة تُظهر الضريبة منفصلة، ويمكن طباعتها أو حفظها PDF.',
                    'Your first invoice is issued when the subscription starts. Each shows VAT separately and prints or saves as a PDF.',
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

          <h2 id="plans" style={{ fontSize: 19, margin: '26px 0 14px' }}>{t('الباقات', 'Plans')}</h2>
          <div className="grid grid-4">
            {PLANS.flatMap((copy) => {
              // A6: the price is the catalogue row's — staff can change it (T19), and checkout charges it.
              const row = data.catalogue.find((c) => c.code === copy.code);
              return row ? [{ ...copy, priceMonthlyMinor: row.priceMonthlyMinor }] : [];
            }).map((plan) => {
              const isCurrent = plan.code === data.plan;
              // During a trial the current plan is the one being tried — it can still be chosen and paid for.
              const isPaidFor = isCurrent && data.status === 'active';
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
                      <li key={line.en} style={{ display: 'flex', gap: 7, fontSize: 13.5, color: line.soon ? 'var(--text-3)' : 'var(--text-2)' }}>
                        {line.soon
                          ? <Clock size={15} aria-hidden style={{ flex: '0 0 auto', marginTop: 3 }} />
                          : <CheckCircle2 size={15} aria-hidden style={{ flex: '0 0 auto', marginTop: 3, color: 'var(--aqua-ink)' }} />}
                        <span>{pick(line)}{line.soon && <> · <strong style={{ fontWeight: 600 }}>{t('قريبًا', 'coming soon')}</strong></>}</span>
                      </li>
                    ))}
                  </ul>
                  {plan.priceMonthlyMinor == null ? (
                    <div style={{ marginTop: 16, display: 'grid', gap: 8 }}>
                      <a className="btn btn-accent" style={{ width: '100%', justifyContent: 'center' }}
                        href={`mailto:${CONTACT.email}?subject=${encodeURIComponent(t('باقة المؤسسات', 'Enterprise plan'))}`}>
                        <Mail size={15} aria-hidden />{t('راسلنا', 'Email us')}
                      </a>
                      <a className="btn btn-ghost" style={{ width: '100%', justifyContent: 'center' }} href={`tel:${CONTACT.tel}`}
                        aria-label={t(`اتصل بنا على ${CONTACT.phone}`, `Call us on ${CONTACT.phone}`)}>
                        <Phone size={15} aria-hidden /><span dir="ltr">{CONTACT.phone}</span>
                      </a>
                      <p className="hint" style={{ margin: 0, textAlign: 'center' }}>
                        <span dir="ltr">{CONTACT.email}</span> · {t('سعر حسب الاتفاق.', 'Priced by agreement.')}
                      </p>
                    </div>
                  ) : (
                    <button type="button" className={`btn ${plan.featured ? 'btn-accent' : 'btn-ghost'}`}
                      style={{ width: '100%', justifyContent: 'center', marginTop: 16 }} disabled={isPaidFor}
                      onClick={() => openCheckout(plan.code, checkout?.cycle ?? data.cycle)}>
                      {isPaidFor ? t('باقتك الحالية', 'Your plan') : <><Sparkles size={15} aria-hidden />{t('اختر هذه', 'Choose this')}</>}
                    </button>
                  )}
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

/** P2.12: the server's coupon refusals, in Arabic. */
const COUPON_AR: [RegExp, string][] = [
  [/not valid yet/, 'هذا الرمز لم يبدأ بعد'],
  [/is not valid/, 'هذا الرمز غير صالح'],
  [/no longer active/, 'هذا الرمز لم يعد فعّالًا'],
  [/expired/, 'انتهت صلاحية هذا الرمز'],
  [/is not for the/, 'هذا الرمز لا ينطبق على هذه الباقة'],
  [/monthly billing/, 'الأشهر المجانية للفوترة الشهرية فقط'],
  [/already used/, 'استخدم متجرك هذا الرمز من قبل'],
  [/used up/, 'نفدت مرات استخدام هذا الرمز'],
  [/Too many|rate/i, 'محاولات كثيرة، حاول بعد قليل'],
];

/**
 * P2.10 — the checkout up to the payment step. The quote is priced exactly as the invoice will
 * be (the shared contract, prices from the plan rows). Paying opens with the payment gateway
 * (P2.3, Moyasar); until then the button says so and nothing is charged.
 */
function Checkout({ data, plan, cycle, onCycle, onClose }: {
  data: BillingSummary; plan: PlanCode; cycle: 'monthly' | 'annual';
  onCycle: (cycle: 'monthly' | 'annual') => void; onClose: () => void;
}) {
  const { t, pick, lang } = useLang();
  const source = useData();
  const [code, setCode] = useState('');
  // The server's answer, kept with the plan and cycle it was for: changing either drops it.
  const [coupon, setCoupon] = useState<{ for: string; quote: CouponQuote } | null>(null);
  const [couponError, setCouponError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const prices = data.catalogue.find((p) => p.code === plan);
  const unit = cycle === 'annual' ? prices?.priceAnnualMinor : prices?.priceMonthlyMinor;
  const name = planByCode(plan).name;
  if (unit == null) return null;
  const applied = coupon?.for === `${plan}:${cycle}` ? coupon.quote : null;
  const discount = applied?.discountMinor ?? 0;
  // VAT on what is left after the discount — the invoice will say the same.
  const quote = priceInvoiceLines([{ description: `${name.en} — ${cycle}`, descriptionAr: name.ar, quantity: 1, unitPriceMinor: unit - discount }]);
  const apply = async () => {
    if (!code.trim()) return;
    setChecking(true);
    setCouponError(null);
    try {
      setCoupon({ for: `${plan}:${cycle}`, quote: await source.checkCoupon(code, plan, cycle) });
    } catch (error) {
      setCoupon(null);
      const message = error instanceof ApiError && error.fields?.code ? error.fields.code[0] : (error as Error).message;
      setCouponError(lang === 'ar' ? COUPON_AR.find(([p]) => p.test(message))?.[1] ?? message : message);
    } finally {
      setChecking(false);
    }
  };
  const saving = prices?.priceMonthlyMinor != null && prices.priceAnnualMinor != null ? prices.priceMonthlyMinor * 12 - prices.priceAnnualMinor : 0;
  const money = (minor: number) => formatMoney(minor, data.currency, lang);

  return (
    <div id="checkout" style={{ marginTop: 18 }}>
      <Panel
        title={t(`الاشتراك في باقة ${pick(name)}`, `Subscribe to ${pick(name)}`)}
        actions={<button type="button" className="btn btn-quiet btn-sm" onClick={onClose} aria-label={t('إغلاق', 'Close')}><X size={16} aria-hidden /></button>}
      >
        <div className="checkout">
          <fieldset className="cycle">
            <legend>{t('طريقة الفوترة', 'Billing')}</legend>
            <label><input type="radio" name="cycle" checked={cycle === 'monthly'} onChange={() => onCycle('monthly')} /> {t('شهريًا', 'Monthly')}</label>
            <label>
              <input type="radio" name="cycle" checked={cycle === 'annual'} onChange={() => onCycle('annual')} /> {t('سنويًا', 'Annually')}
              {saving > 0 && <Badge tone="ok">{t(`وفّر ${money(saving)}`, `Save ${money(saving)}`)}</Badge>}
            </label>
          </fieldset>
          <dl className="quote">
            <div><dt>{t('الباقة', 'Plan')} · {cycle === 'annual' ? t('سنة', '1 year') : t('شهر', '1 month')}</dt><dd className="num">{money(unit)}</dd></div>
            {applied && (
              <div><dt>{t('خصم', 'Discount')} · <span dir="ltr">{applied.code}</span> ({pick(applied.description)})</dt><dd className="num">{discount ? `−${money(discount)}` : '—'}</dd></div>
            )}
            <div><dt>{t('ضريبة القيمة المضافة 15%', 'VAT 15%')}</dt><dd className="num">{money(quote.vatMinor)}</dd></div>
            <div className="total"><dt>{t('الإجمالي', 'Total')}</dt><dd className="num">{money(quote.totalMinor)}</dd></div>
          </dl>
        </div>
        <div className="coupon-row">
          <label htmlFor="coupon">{t('رمز الخصم', 'Coupon code')}</label>
          <div>
            <input id="coupon" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} maxLength={40} aria-invalid={!!couponError}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void apply(); } }} />
            <button type="button" className="btn btn-ghost" onClick={apply} disabled={checking || !code.trim()}>{checking ? t('لحظة…', 'Checking…') : t('طبّق', 'Apply')}</button>
          </div>
          {couponError && <span className="field-error" role="alert">{couponError}</span>}
          {applied?.freeMonths ? <span className="field-hint">{t(`أول ${applied.freeMonths} أشهر مجانًا بعد الدفع الأول.`, `The first ${applied.freeMonths} months are free after the first payment.`)}</span> : null}
        </div>
        <p className="hint">
          {t('تصدر الفاتورة باسم منشأتك ورقمها الضريبي كما في ', 'The invoice is issued to your business name and VAT number as entered in ')}
          <AppLink href="/dashboard/settings">{t('الإعدادات', 'Settings')}</AppLink>.
        </p>
        <div className="btn-row">
          <button type="button" className="btn btn-primary" disabled aria-describedby="pay-note">
            <Lock size={15} aria-hidden />{t(`ادفع ${money(quote.totalMinor)}`, `Pay ${money(quote.totalMinor)}`)}
          </button>
        </div>
        <p id="pay-note" className="hint">{t(
          'الدفع يُفتح عند ربط بوابة الدفع (Moyasar). لا يُخصم أي مبلغ الآن.',
          'Payment opens once the payment gateway (Moyasar) is connected. Nothing is charged now.',
        )}</p>
      </Panel>
    </div>
  );
}
