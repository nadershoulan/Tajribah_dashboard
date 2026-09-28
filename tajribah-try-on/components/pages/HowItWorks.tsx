'use client';

import { useLang } from '@/lib/i18n';
import { Shell } from '@/components/site/chrome';
import { CtaBand, PageHero, SectionHead } from '@/components/site/ui';

export default function HowItWorks() {
  const { t } = useLang();

  const merchant = [
    { h: t('اختر باقتك', 'Pick a plan'), p: t('سجّل متجرك واختر الباقة التي تناسب عدد منتجاتك. يمكنك الترقية لاحقًا في أي وقت.', 'Register your store and choose the plan that fits your product count. Upgrade any time.') },
    { h: t('اربط متجرك', 'Connect your store'), p: t('وافق على الربط من سلة أو زد أو Shopify أو WooCommerce، أو أضف سطر التضمين إلى قالب صفحة المنتج.', 'Approve the connection from Salla, Zid, Shopify or WooCommerce, or add the embed line to your product-page template.') },
    { h: t('يصلنا كتالوجك', 'Your catalogue arrives'), p: t('تُستورد المنتجات والصور والأسعار تلقائيًا، وتبقى متزامنة مع كل تعديل في متجرك.', 'Products, images and prices import automatically and stay in sync with every change in your store.') },
    { h: t('جهّز المنتج', 'Prepare the product'), p: t('اختر المنتج، وأضف صورته الواضحة وأبعاده بالمليمتر. للواقع المعزز، ارفع صورًا من ثلاث زوايا أو اطلب منا النمذجة.', 'Choose a product and add a clean photo and its millimetre dimensions. For AR, upload photos from three angles or ask us to model it.') },
    { h: t('انشر الزر', 'Publish the button'), p: t('يظهر زر «جرّبها» في صفحة المنتج بلون متجرك. لا تغيير على صفحة الدفع ولا على السلة.', 'A “Try it” button appears on the product page in your store’s colour. Checkout and cart stay untouched.') },
    { h: t('راقب الأثر', 'Watch the effect'), p: t('تعرض لوحة التحكم عدد الجلسات والتجارب والمنتجات الأكثر تجربة، ونسبة الشراء بعد التجربة.', 'The dashboard shows sessions, try-ons, the most-tried products and how often a try-on leads to a purchase.') },
  ];

  const shopper = [
    { h: t('يفتح صفحة المنتج', 'Opens the product page'), p: t('في متجرك، كالعادة.', 'In your store, as usual.') },
    { h: t('يضغط «جرّبها»', 'Presses “Try it”'), p: t('يُفتح الاستوديو فوق الصفحة دون مغادرتها.', 'The studio opens over the page without leaving it.') },
    { h: t('يختار طريقته', 'Chooses a way to try'), p: t('على العارضة، أو على صورته، أو بجانب عملة وبطاقة وهاتف.', 'On the model, on their own photo, or beside a coin, a card and a phone.') },
    { h: t('يقرر', 'Decides'), p: t('يغلق الاستوديو ويضيف المنتج إلى السلة وهو يعرف مقاسه.', 'Closes the studio and adds to cart knowing the size.') },
  ];

  const layers = [
    { h: t('الزر والاستوديو', 'Button and studio'), p: t('ملفات ثابتة من شبكة توزيع محتوى، تُحمَّل بسرعة من أقرب نقطة للعميل.', 'Static files from a CDN, served from the point nearest the shopper.') },
    { h: t('إعدادات المنتج', 'Product settings'), p: t('تُقرأ من طبقة حافة سريعة، لا من قاعدة البيانات. حتى لو توقفت لوحة التحكم، يستمر الزر في العمل داخل متجرك.', 'Read from a fast edge layer, not the database. Even if the dashboard is down, the button keeps working in your store.') },
    { h: t('تحديد المعصم', 'Wrist detection'), p: t('نموذج رؤية يعمل داخل متصفح العميل. الصورة لا تغادر جهازه للتحليل.', 'A vision model running in the shopper’s browser. The photo never leaves the device for analysis.') },
    { h: t('الإحصاءات', 'Analytics'), p: t('أحداث مجهولة الهوية: فُتح الاستوديو، استُخدمت طريقة كذا، أُضيف المنتج إلى السلة.', 'Anonymous events: studio opened, this mode used, product added to cart.') },
  ];

  return (
    <Shell current="/how-it-works">
      <PageHero eyebrow={t('كيف تعمل', 'How it works')}
        title={t('من متجرك إلى أول تجربة', 'From your store to the first try-on')}
        lead={t('رحلتان منفصلتان: رحلة التاجر الذي يجهّز منتجاته مرة واحدة، ورحلة العميل الذي يجرّب في ثوانٍ.',
          'Two separate journeys: the merchant who prepares products once, and the shopper who tries in seconds.')} />

      <section className="sec">
        <div className="wrap">
          <SectionHead eyebrow={t('رحلة التاجر', 'Merchant journey')} title={t('ست خطوات، معظمها تلقائي', 'Six steps, most of them automatic')} />
          <ol className="timeline">
            {merchant.map((s, i) => (
              <li key={s.h}><span className="step-n">{i + 1}</span><div><h3>{s.h}</h3><p>{s.p}</p></div></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap">
          <SectionHead eyebrow={t('رحلة العميل', 'Shopper journey')} title={t('من السؤال إلى القرار', 'From question to decision')} />
          <ol className="journey">
            {shopper.map((s, i) => (
              <li key={s.h}><span className="step-n">{i + 1}</span><h3>{s.h}</h3><p>{s.p}</p></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <SectionHead eyebrow={t('تحت الغطاء', 'Under the hood')} title={t('مبنية لتعمل داخل متاجر الآخرين', 'Built to run inside other people’s stores')}
            lead={t('الزر يعيش في صفحة منتجك، لذلك صممناه ليكون خفيفًا وسريعًا ومستقلًا عن بقية النظام.',
              'The button lives on your product page, so it is designed to be light, fast and independent of the rest of the system.')} />
          <div className="grid-4">
            {layers.map((l) => <article key={l.h} className="feature layer"><h3>{l.h}</h3><p>{l.p}</p></article>)}
          </div>
        </div>
      </section>

      <CtaBand />
    </Shell>
  );
}
