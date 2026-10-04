'use client';

import { useState } from 'react';
import { Check, Minus } from 'lucide-react';
import { useLang, pick } from '@site/lib/i18n';
import { SiteLink } from '@site/lib/site-env';
import { COMPANY } from '@site/lib/site';
import { ANNUAL_MONTHS, MATRIX, PLANS, num, type Cycle } from '@site/lib/plans';
import { Forward, Shell } from '@site/components/site/chrome';
import { CycleSwitch, RoiPanel } from '@site/components/site/roi';
import { CtaBand, PageHero, SectionHead } from '@site/components/site/ui';

export default function Pricing() {
  const { lang, t } = useLang();
  const [cycle, setCycle] = useState<Cycle>('monthly');
  const annual = cycle === 'annual';

  const addons = [
    { h: t('أرصدة الذكاء الاصطناعي', 'AI credits'), p: t('لتوليد نماذج ثلاثية الأبعاد من الصور: 10 أرصدة لكل نموذج. تُحتسب لكل عملية توليد.', 'For generating 3D models from photos: 10 credits per model. Charged per generation.') },
    { h: t('نمذجة ثلاثية الأبعاد احترافية', 'Professional 3D modelling'), p: t('ينفذ فريقنا نموذجًا دقيقًا للمنتج حين لا تكفي الصور. من 349 ريالًا للمنتج قبل الضريبة، مع جولتي تعديل.', 'Our team builds an accurate model when photos are not enough. From 349 riyals per product before VAT, with two rounds of changes.') }, // T68: PRICE_TIERS
  ];

  return (
    <Shell current="/pricing">
      <PageHero eyebrow={t('الأسعار', 'Pricing')}
        title={t('باقات واضحة، تبدأ بـ99 ريالًا', 'Clear plans, from 99 riyals')}
        lead={t('اشتراك بالريال السعودي، شهريًا أو سنويًا. ابدأ بعدد قليل من المنتجات ووسّع حين ترى الأثر.',
          'A subscription in Saudi riyals, monthly or annual. Start with a few products and expand when you see the effect.')}>
        <CycleSwitch cycle={cycle} onChange={setCycle} />
      </PageHero>

      <section className="sec">
        <div className="wrap">
          <div className="plans">
            {PLANS.map((p) => (
              <article key={p.id} className={'plan' + (p.featured ? ' featured' : '')}>
                {p.featured && <span className="plan-flag">{t('الأكثر اختيارًا', 'Most chosen')}</span>}
                <h2>{pick(p.name, lang)}</h2>
                <p className="plan-blurb">{pick(p.blurb, lang)}</p>
                <p className="plan-price">
                  {p.price === null || p.priceAnnual === null
                    ? <span className="custom">{t('حسب الطلب', 'Custom pricing')}</span>
                    : <><bdi>{num(annual ? p.priceAnnual : p.price)}</bdi>
                      <span>{annual ? t('ر.س / سنويًا', 'SAR / year') : t('ر.س / شهريًا', 'SAR / month')}</span></>}
                </p>
                {annual && p.priceAnnual !== null && (
                  <p className="plan-cycle">{t(
                    `بسعر ${ANNUAL_MONTHS} أشهر · نحو ${num(p.priceAnnual / 12)} ر.س شهريًا`,
                    `${ANNUAL_MONTHS} months’ price · about ${num(p.priceAnnual / 12)} SAR a month`)}</p>
                )}
                <p className="plan-products">{pick(p.products, lang)}</p>
                <ul>{p.features.map((f) => <li key={f.en}><Check size={16} aria-hidden />{pick(f, lang)}</li>)}</ul>
                {/* T32: a priced plan starts the free trial in the dashboard; Enterprise talks to sales. */}
                <SiteLink href={p.price ? `${COMPANY.appUrl}/register?plan=${p.id}` : '/contact'} className={'btn ' + (p.featured ? 'btn-primary' : 'btn-ghost')}>
                  {p.price ? t('ابدأ بهذه الباقة', 'Start with this plan') : t('تواصل مع المبيعات', 'Talk to sales')}
                </SiteLink>
              </article>
            ))}
          </div>
          <p className="fine center">{annual
            ? t('الأسعار سنوية ولا تشمل ضريبة القيمة المضافة (15%). تصلك فاتورة ضريبية إلكترونية مع كل عملية دفع.',
              'Prices are annual and exclude 15% VAT. You receive an electronic tax invoice with every payment.')
            : t('الأسعار شهرية ولا تشمل ضريبة القيمة المضافة (15%). تصلك فاتورة ضريبية إلكترونية مع كل عملية دفع.',
              'Prices are monthly and exclude 15% VAT. You receive an electronic tax invoice with every payment.')}</p>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap">
          <SectionHead eyebrow={t('المقارنة', 'Compare')} title={t('ما الذي تتضمنه كل باقة', 'What each plan includes')} />
          <div className="table-scroll">
            <table className="matrix">
              <thead>
                <tr><th scope="col"><span className="sr-only">{t('الميزة', 'Feature')}</span></th>{PLANS.map((p) => <th key={p.id} scope="col">{pick(p.name, lang)}</th>)}</tr>
              </thead>
              <tbody>
                {MATRIX.map((row) => (
                  <tr key={row.label.en}>
                    <th scope="row">{pick(row.label, lang)}</th>
                    {row.cells.map((c, i) => (
                      <td key={i}>
                        {c === true ? <Check size={17} aria-label={t('متضمَّن', 'Included')} className="yes" />
                          : c === false ? <Minus size={17} aria-label={t('غير متضمَّن', 'Not included')} className="no" />
                            : pick(c, lang)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <SectionHead eyebrow={t('الحساب', 'The arithmetic')}
            title={t('متى تسدّد الباقة نفسها؟', 'When does the plan pay for itself?')}
            lead={t('اكتب أرقام متجرك وافتراضاتك، وسترى الحساب كاملًا خطوة بخطوة — لا وعودًا.',
              'Put in your store’s numbers and your own assumptions, and see the whole calculation, step by step — not a promise.')} />
          <RoiPanel cycle={cycle} />
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap split">
          <div>
            <SectionHead eyebrow={t('إضافات', 'Add-ons')} title={t('حين تحتاج أكثر', 'When you need more')} />
            <div className="addons">{addons.map((a) => <article key={a.h}><h3>{a.h}</h3><p>{a.p}</p></article>)}</div>
          </div>
          <div className="panel-card">
            <h3>{t('الفوترة باختصار', 'Billing in brief')}</h3>
            <ul className="plain">
              <li>{t('تُجدَّد الباقة تلقائيًا في نهاية كل فترة — شهر أو سنة بحسب اختيارك.',
                'Plans renew automatically at the end of each period — a month or a year, as you choose.')}</li>
              <li>{t(`الاشتراك السنوي يُدفع مرة واحدة بسعر ${ANNUAL_MONTHS} أشهر.`,
                `An annual subscription is paid once, at ${ANNUAL_MONTHS} months’ price.`)}</li>
              <li>{t('الترقية فورية، والتخفيض يسري من الفترة التالية.', 'Upgrades apply immediately; downgrades from the next period.')}</li>
              <li>{t('الإلغاء متاح في أي وقت ويسري في نهاية الفترة الحالية.', 'Cancel any time; it takes effect at the end of the current period.')}</li>
            </ul>
            <SiteLink href="/refund" className="link-more">{t('سياسة الإلغاء والاسترداد', 'Cancellation and refund policy')}<Forward size={16} /></SiteLink>
          </div>
        </div>
      </section>

      <CtaBand />
    </Shell>
  );
}
