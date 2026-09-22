'use client';

import { Check, Minus } from 'lucide-react';
import { useLang, pick } from '@/lib/i18n';
import { SiteLink } from '@/lib/site-env';
import { MATRIX, PLANS } from '@/lib/plans';
import { Forward, Shell } from '@/components/site/chrome';
import { CtaBand, PageHero, SectionHead } from '@/components/site/ui';

export default function Pricing() {
  const { lang, t } = useLang();

  const addons = [
    { h: t('أرصدة الذكاء الاصطناعي', 'AI credits'), p: t('لتوليد نماذج ثلاثية الأبعاد من الصور ولتجارب إضافية فوق حد باقتك. تُحتسب لكل عملية توليد.', 'For generating 3D models from photos and for try-ons beyond your plan. Charged per generation.') },
    { h: t('نمذجة ثلاثية الأبعاد احترافية', 'Professional 3D modelling'), p: t('ينفذ فريقنا نموذجًا دقيقًا للمنتج حين لا تكفي الصور. تُسعَّر لكل منتج.', 'Our team builds an accurate model when photos are not enough. Priced per product.') },
  ];

  return (
    <Shell current="/pricing">
      <PageHero eyebrow={t('الأسعار', 'Pricing')}
        title={t('باقات واضحة، تبدأ بـ99 ريالًا', 'Clear plans, from 99 riyals')}
        lead={t('اشتراك شهري بالريال السعودي. ابدأ بعدد قليل من المنتجات ووسّع حين ترى الأثر.',
          'A monthly subscription in Saudi riyals. Start with a few products and expand when you see the effect.')} />

      <section className="sec">
        <div className="wrap">
          <div className="plans">
            {PLANS.map((p) => (
              <article key={p.id} className={'plan' + (p.featured ? ' featured' : '')}>
                {p.featured && <span className="plan-flag">{t('الأكثر اختيارًا', 'Most chosen')}</span>}
                <h2>{pick(p.name, lang)}</h2>
                <p className="plan-blurb">{pick(p.blurb, lang)}</p>
                <p className="plan-price">
                  {p.price ? <><bdi>{p.price}</bdi><span>{t('ر.س / شهريًا', 'SAR / month')}</span></> : <span className="custom">{t('حسب الطلب', 'Custom pricing')}</span>}
                </p>
                <p className="plan-products">{pick(p.products, lang)}</p>
                <ul>{p.features.map((f) => <li key={f.en}><Check size={16} aria-hidden />{pick(f, lang)}</li>)}</ul>
                <SiteLink href="/contact" className={'btn ' + (p.featured ? 'btn-primary' : 'btn-ghost')}>
                  {p.price ? t('ابدأ بهذه الباقة', 'Start with this plan') : t('تواصل مع المبيعات', 'Talk to sales')}
                </SiteLink>
              </article>
            ))}
          </div>
          <p className="fine center">{t('الأسعار شهرية ولا تشمل ضريبة القيمة المضافة (15%). تصلك فاتورة ضريبية إلكترونية مع كل عملية دفع.',
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
        <div className="wrap split">
          <div>
            <SectionHead eyebrow={t('إضافات', 'Add-ons')} title={t('حين تحتاج أكثر', 'When you need more')} />
            <div className="addons">{addons.map((a) => <article key={a.h}><h3>{a.h}</h3><p>{a.p}</p></article>)}</div>
          </div>
          <div className="panel-card">
            <h3>{t('الفوترة باختصار', 'Billing in brief')}</h3>
            <ul className="plain">
              <li>{t('تُجدَّد الباقة شهريًا تلقائيًا.', 'Plans renew monthly.')}</li>
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
