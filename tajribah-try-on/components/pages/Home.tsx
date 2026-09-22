'use client';

import { Camera, Hand, Languages, LockKeyhole, QrCode, Ruler, ScanLine, Smartphone } from 'lucide-react';
import { useLang, pick } from '@/lib/i18n';
import { SiteLink } from '@/lib/site-env';
import { PLANS } from '@/lib/plans';
import { Forward, Shell } from '@/components/site/chrome';
import { CtaBand, LiveScene, SectionHead, Tag } from '@/components/site/ui';
import { FAQ } from '@/components/pages/Faq';

export default function Home() {
  const { lang, t } = useLang();

  const questions = [
    { icon: Ruler, q: t('«كم حجمها فعلًا؟»', '“How big is it, really?”'),
      a: t('قارن المنتج بريال سعودي أو إيربودز أو آيفون، كلها بالمقياس نفسه.', 'Compare it with a Saudi riyal, AirPods or an iPhone — all at one scale.'),
      mode: t('قارن الحجم', 'Compare size') },
    { icon: Hand, q: t('«كيف تبدو على المعصم؟»', '“How does it look on a wrist?”'),
      a: t('صور حقيقية لمعصم عارضة، والساعة عليه بالحجم الصحيح وبالزاوية الصحيحة.', 'Real model photography, with the watch on it at the right size and angle.'),
      mode: t('على النموذج', 'On model') },
    { icon: Camera, q: t('«كيف تبدو عليّ أنا؟»', '“How does it look on me?”'),
      a: t('صورة من جوال العميل، ونحدّد معصمه تلقائيًا ونضع الساعة عليه.', 'A photo from the shopper’s phone; we find the wrist and place the watch on it.'),
      mode: t('عليّ', 'On me') },
  ];

  const features = [
    { icon: ScanLine, h: t('بالمقاس الحقيقي، لا بالتقريب', 'True scale, not a guess'),
      p: t('كل منتج يُعرض بأبعاده بالمليمتر، فيرى عميلك حجمه الحقيقي بالنسبة لأشياء يعرفها.', 'Every product is shown from its millimetre dimensions, so shoppers see its real size next to things they know.') },
    { icon: Camera, h: t('تحديد المعصم تلقائيًا', 'Automatic wrist detection'),
      p: t('نموذج رؤية يعمل داخل متصفح العميل يحدّد المعصم في الصورة ويضع القطعة بزاويتها الصحيحة.', 'A vision model running in the shopper’s browser finds the wrist in a photo and places the piece at the right angle.') },
    { icon: QrCode, h: t('من الحاسوب إلى الجوال', 'From desktop to phone'),
      p: t('يمسح العميل رمز QR، فيلتقط صورة معصمه بجواله وتظهر النتيجة على شاشة الحاسوب.', 'The shopper scans a QR code, takes a wrist photo on the phone, and sees the result on the desktop screen.') },
    { icon: Languages, h: t('عربية أولًا', 'Arabic first'),
      p: t('واجهة مصممة من اليمين إلى اليسار منذ البداية، لا ترجمة لاحقة لواجهة إنجليزية.', 'Designed right-to-left from the start — not an English interface translated afterwards.') },
    { icon: LockKeyhole, h: t('الخصوصية افتراضيًا', 'Private by default'),
      p: t('تحليل الصورة يتم على جهاز العميل. لا نحفظ صور المعاصم ولا نبني منها بصمات حيوية.', 'Photo analysis happens on the shopper’s device. We do not keep wrist photos or build biometric templates from them.') },
    { icon: Smartphone, h: t('من دون تطبيق', 'No app to install'),
      p: t('كل شيء يعمل في متصفح الجوال أو الحاسوب داخل صفحة منتجك نفسها.', 'Everything runs in the mobile or desktop browser, inside your own product page.') },
  ];

  const steps = [
    { h: t('اربط متجرك', 'Connect your store'), p: t('سلة أو زد أو Shopify أو WooCommerce، أو أي متجر عبر سطر تضمين واحد.', 'Salla, Zid, Shopify or WooCommerce — or any store with a single embed line.') },
    { h: t('أضف الصور والمقاسات', 'Add photos and dimensions'), p: t('صورة واضحة للمنتج وأبعاده بالمليمتر. ويمكننا تجهيزها عنك.', 'A clean product photo and its dimensions in millimetres. We can prepare them for you.') },
    { h: t('فعّل زر «جرّبها»', 'Switch on “Try it”'), p: t('يظهر الزر في صفحة المنتج، ويبدأ عملاؤك التجربة مباشرة.', 'The button appears on the product page and shoppers start trying immediately.') },
  ];

  const categories = [
    { name: t('الساعات', 'Watches'), live: true },
    { name: t('الخواتم', 'Rings'), live: false },
    { name: t('الأساور', 'Bracelets'), live: false },
    { name: t('القلائد', 'Necklaces'), live: false },
    { name: t('النظارات', 'Eyewear'), live: false },
    { name: t('الحقائب', 'Bags'), live: false },
  ];

  return (
    <Shell current="/">
      <section className="hero">
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">{t('التجربة الافتراضية للمتاجر الإلكترونية', 'Virtual try-on for online stores')}</p>
            <h1>{t('دع عميلك يجرّب قبل أن يشتري', 'Let shoppers try it on before they buy')}</h1>
            <p className="lead">
              {t('تجربة تضيف إلى صفحات منتجاتك تجربةً افتراضية ومقارنةً بالحجم الحقيقي للساعات والمجوهرات والإكسسوارات، ليعرف عميلك المقاس قبل أن يضغط «شراء».',
                'Tajribah adds virtual try-on and true-size comparison to your product pages for watches, jewellery and accessories, so shoppers know the size before they press “buy”.')}
            </p>
            <div className="hero-actions">
              <SiteLink href="/demo" className="btn btn-primary">{t('جرّب العرض التجريبي', 'Try the live demo')}<Forward /></SiteLink>
              <SiteLink href="/contact" className="btn btn-ghost">{t('احجز عرضًا لمتجرك', 'Book a store demo')}</SiteLink>
            </div>
            <p className="hero-note">{t('يستخدم العرض التجريبي متجر فايلت مثالًا توضيحيًا.', 'The live demo uses Failet as an illustrative example store.')}</p>
          </div>
          <LiveScene />
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <SectionHead eyebrow={t('ثلاثة أسئلة قبل كل شراء', 'Three questions before every purchase')}
            title={t('العميل لا يستطيع لمس المنتج. فليجرّبه إذن.', 'Shoppers can’t touch the product. So let them try it.')}
            lead={t('من يشتري ساعة أو خاتمًا عبر الإنترنت يسأل دائمًا الأسئلة نفسها. لكل سؤال طريقة عرض تجيب عنه.',
              'Anyone buying a watch or a ring online asks the same questions. Each one has a view that answers it.')} />
          <div className="grid-3">
            {questions.map(({ icon: Icon, q, a, mode }) => (
              <article key={mode} className="q-card">
                <Icon size={26} aria-hidden className="q-icon" />
                <h3>{q}</h3>
                <p>{a}</p>
                <span className="q-mode">{mode}</span>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap">
          <SectionHead eyebrow={t('المزايا', 'Features')} title={t('مصممة لمتاجر السوق السعودي', 'Built for stores selling in Saudi Arabia')} />
          <div className="grid-3 features">
            {features.map(({ icon: Icon, h, p }) => (
              <article key={h} className="feature">
                <span className="f-icon"><Icon size={20} aria-hidden /></span>
                <h3>{h}</h3>
                <p>{p}</p>
              </article>
            ))}
          </div>
          <div className="sec-more"><SiteLink href="/features" className="link-more">{t('كل المزايا', 'All features')}<Forward size={16} /></SiteLink></div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap split">
          <div>
            <SectionHead eyebrow={t('كيف تعمل', 'How it works')} title={t('ثلاث خطوات من متجرك إلى أول تجربة', 'Three steps from your store to the first try-on')} />
            <ol className="steps">
              {steps.map((s, i) => (
                <li key={s.h}><span className="step-n">{i + 1}</span><div><h3>{s.h}</h3><p>{s.p}</p></div></li>
              ))}
            </ol>
            <SiteLink href="/how-it-works" className="link-more">{t('التفاصيل الكاملة', 'The full walkthrough')}<Forward size={16} /></SiteLink>
          </div>
          <div className="stack-cards">
            <div className="panel-card">
              <h3>{t('المنصات', 'Platforms')}</h3>
              <ul className="platforms">
                {['سلة Salla', 'زد Zid', 'Shopify', 'WooCommerce'].map((p) => <li key={p}>{p}</li>)}
                <li className="any">{t('أي متجر عبر كود التضمين', 'Any store via embed code')}</li>
              </ul>
            </div>
            <div className="panel-card">
              <h3>{t('الفئات', 'Categories')}</h3>
              <ul className="cats">
                {categories.map((c) => (
                  <li key={c.name}>{c.name}{c.live ? <Tag kind="live">{t('متاح', 'Live')}</Tag> : <Tag kind="soon">{t('قريبًا', 'Coming')}</Tag>}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <section className="sec sec-dark">
        <div className="wrap split privacy-band">
          <div>
            <p className="eyebrow">{t('الخصوصية', 'Privacy')}</p>
            <h2>{t('صورة العميل تبقى على جهازه', 'The shopper’s photo stays on their device')}</h2>
            <p className="lead">{t('نموذج تحديد المعصم يعمل داخل المتصفح، فلا تُرفع الصورة إلى خوادمنا لتحليلها. وحين ينقل العميل صورته من الجوال إلى الحاسوب عبر رمز QR، تُحفظ مؤقتًا وتُحذف فور استلامها أو بعد 30 دقيقة.',
              'The wrist-detection model runs inside the browser, so photos are never uploaded to our servers for analysis. When a shopper moves a photo from phone to desktop with a QR code, it is held briefly and deleted as soon as it arrives, or after 30 minutes.')}</p>
            <SiteLink href="/try-on-privacy" className="link-more light">{t('كيف نتعامل مع الصور', 'How we handle photos')}<Forward size={16} /></SiteLink>
          </div>
          <ul className="privacy-facts">
            <li><strong>{t('على الجهاز', 'On device')}</strong><span>{t('تحليل الصورة', 'Photo analysis')}</span></li>
            <li><strong>{t('30 دقيقة', '30 min')}</strong><span>{t('أقصى مدة لصورة منقولة', 'Longest a transferred photo is kept')}</span></li>
            <li><strong>{t('صفر', 'Zero')}</strong><span>{t('بصمات حيوية محفوظة', 'Biometric templates stored')}</span></li>
          </ul>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <SectionHead center eyebrow={t('الأسعار', 'Pricing')} title={t('باقات شهرية بالريال السعودي', 'Monthly plans in Saudi riyals')}
            lead={t('ابدأ بأكثر منتجاتك مبيعًا، ثم وسّع حين ترى الأثر.', 'Start with your best sellers, then grow once you see the effect.')} />
          <div className="plan-strip">
            {PLANS.map((p) => (
              <SiteLink key={p.id} href="/pricing" className={'plan-mini' + (p.featured ? ' featured' : '')}>
                <span className="pm-name">{pick(p.name, lang)}</span>
                <span className="pm-price">{p.price ? <><bdi>{p.price}</bdi> <small>{t('ر.س / شهريًا', 'SAR / mo')}</small></> : t('حسب الطلب', 'Custom')}</span>
                <span className="pm-products">{pick(p.products, lang)}</span>
              </SiteLink>
            ))}
          </div>
          <p className="fine center">{t('الأسعار لا تشمل ضريبة القيمة المضافة.', 'Prices exclude VAT.')}</p>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap narrow">
          <SectionHead center eyebrow={t('أسئلة شائعة', 'Common questions')} title={t('قبل أن تسأل', 'Before you ask')} />
          <FAQ limit={4} />
          <div className="sec-more center"><SiteLink href="/faq" className="link-more">{t('كل الأسئلة', 'All questions')}<Forward size={16} /></SiteLink></div>
        </div>
      </section>

      <CtaBand />
    </Shell>
  );
}
