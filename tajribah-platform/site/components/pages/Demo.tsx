'use client';

import { useState } from 'react';
import { Info } from 'lucide-react';
import { DEMO_BAG, DEMO_GLASSES, DEMO_NECKLACE, DEMO_RING } from '@site/lib/demo-product';
import { useLang } from '@site/lib/i18n';
import { SiteLink } from '@site/lib/site-env';
import Studio from '@site/components/studio/Studio';
import { Forward, Shell } from '@site/components/site/chrome';
import { CtaBand } from '@site/components/site/ui';

export default function Demo() {
  const { t } = useLang();
  // T68: the same studio on glasses — a real face and a real frame (ASSETS.md).
  const [kind, setKind] = useState<'watch' | 'glasses' | 'ring' | 'necklace' | 'bag'>('watch');
  const kinds = [{ id: 'watch', label: t('ساعة', 'Watch') }, { id: 'glasses', label: t('نظارة', 'Glasses') }, { id: 'ring', label: t('خاتم', 'Ring') }, { id: 'necklace', label: t('قلادة', 'Necklace') }, { id: 'bag', label: t('حقيبة', 'Bag') }] as const;
  return (
    <Shell current="/demo">
      <section className="demo-head">
        <div className="wrap">
          <nav className="crumbs" aria-label={t('مسار التنقل', 'Breadcrumb')}>
            <SiteLink href="/">{t('الرئيسية', 'Home')}</SiteLink><span aria-hidden>/</span><span aria-current="page">{t('العرض التجريبي', 'Live demo')}</span>
          </nav>
          <div className="demo-intro">
            <div>
              <p className="eyebrow">{t('العرض التجريبي', 'Live demo')}</p>
              <h1>{t('هكذا تظهر تجربة داخل صفحة منتج', 'This is Tajribah inside a product page')}</h1>
              <p className="lead">{t('جرّب الطرق الثلاث على ساعة حقيقية: على النموذج، وعلى صورتك، وبجانب أشياء تعرف حجمها.',
                'Try all three modes on a real watch: on the model, on your own photo, and beside things whose size you know.')}</p>
            </div>
            <p className="demo-note"><Info size={16} aria-hidden />
              {t('نستخدم «فايلت» مثالًا لمتجر ساعات سعودي. هذا العرض توضيحي ولا يعني شراكة أو اعتمادًا من فايلت.',
                'We use Failet as an example of a Saudi watch store. This demo is illustrative and does not imply a partnership with or endorsement by Failet.')}</p>
          </div>
        </div>
      </section>

      <section className="demo-body">
        <div className="wrap">
          <div className="cycle demo-kind">
            <div className="cycle-toggle" role="group" aria-label={t('ما تجرّبه', 'What to try on')}>
              {kinds.map((k) => (
                <button key={k.id} type="button" aria-pressed={kind === k.id} className={'cycle-btn' + (kind === k.id ? ' on' : '')} onClick={() => setKind(k.id)}>
                  {k.label}
                </button>
              ))}
            </div>
            {kind === 'bag' && <span className="cycle-save">{t('حقيبة مثال وصور حقيقية مرخّصة. على العارضة وبجانب أشياء تعرف حجمها.',
              'An example bag and real, licensed photos. On the model and beside things you know.')}</span>}
            {kind === 'necklace' && <span className="cycle-save">{t('قلادة مثال وصور حقيقية مرخّصة. على العارضة وبجانب أشياء تعرف حجمها؛ تجربتها على صورتك تأتي لاحقًا.',
              'An example necklace and real, licensed photos. On the model and beside things you know; on your own photo comes later.')}</span>}
            {kind === 'ring' && <span className="cycle-save">{t('خاتم مثال وصور حقيقية مرخّصة. على النموذج وبجانب الريال؛ تجربته على صورتك تأتي لاحقًا.',
              'An example ring and real, licensed photos. On the model and beside a riyal; on your own photo comes later.')}</span>}
            {kind === 'glasses' && <span className="cycle-save">{t('إطار مثال وصور حقيقية مرخّصة. على النموذج وبجانب أشياء تعرف حجمها؛ تجربتها على صورتك تأتي لاحقًا.',
              'An example frame and real, licensed photos. On the model and beside things you know; on your own photo comes later.')}</span>}
          </div>
          {kind === 'glasses' ? <Studio key="glasses" product={DEMO_GLASSES} /> : kind === 'ring' ? <Studio key="ring" product={DEMO_RING} /> : kind === 'necklace' ? <Studio key="necklace" product={DEMO_NECKLACE} /> : kind === 'bag' ? <Studio key="bag" product={DEMO_BAG} /> : <Studio key="watch" />}
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap grid-3 seen">
          <article><h3>{t('ما رأيته', 'What you just saw')}</h3><p>{t('استوديو التجربة كما سيفتح لعملائك عند الضغط على زر «جرّبها» في صفحة المنتج.', 'The try-on studio exactly as it opens for your shoppers when they press “Try it” on a product page.')}</p></article>
          <article><h3>{t('ما يلزم من منتجك', 'What it needs from your product')}</h3><p>{t('صورة واضحة للمنتج وأبعاده بالمليمتر. نولّد الباقي، أو نجهّزه لك.', 'A clean product photo and its millimetre dimensions. We generate the rest, or prepare it for you.')}</p></article>
          <article><h3>{t('الخطوة التالية', 'Next step')}</h3><p>{t('نجهّز العرض نفسه على منتج من متجرك.', 'We set up this same demo on a product from your store.')}</p>
            <SiteLink href="/contact" className="link-more">{t('احجز عرضًا لمتجرك', 'Book a store demo')}<Forward size={16} /></SiteLink></article>
        </div>
      </section>
      <CtaBand />
    </Shell>
  );
}
