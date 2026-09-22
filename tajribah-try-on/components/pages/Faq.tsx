'use client';

import { Plus } from 'lucide-react';
import { useLang, pick, type Bi } from '@/lib/i18n';
import { Shell } from '@/components/site/chrome';
import { CtaBand, PageHero } from '@/components/site/ui';

type QA = { q: Bi; a: Bi };

const GROUPS: { title: Bi; items: QA[] }[] = [
  {
    title: { ar: 'للمتاجر', en: 'For stores' },
    items: [
      { q: { ar: 'هل أحتاج إلى نماذج ثلاثية الأبعاد لمنتجاتي؟', en: 'Do I need 3D models of my products?' },
        a: { ar: 'لا. تكفي صورة واضحة للمنتج وأبعاده بالمليمتر لبدء المقارنة بالحجم والعرض على العارضة. وإن احتجت نماذج ثلاثية الأبعاد للواقع المعزز، نولّدها من صورك أو ننفذها لك خدمةً مستقلة.',
             en: 'No. A clean product photo and its millimetre dimensions are enough for size comparison and the on-model view. If you want 3D models for AR, we generate them from your photos or build them as a separate service.' } },
      { q: { ar: 'مع أي منصات تعمل تجربة؟', en: 'Which platforms does Tajribah work with?' },
        a: { ar: 'نبني تكاملات مع سلة وزد وShopify وWooCommerce، وتعمل تجربة على أي متجر آخر عبر سطر تضمين واحد في صفحة المنتج.',
             en: 'We are building integrations with Salla, Zid, Shopify and WooCommerce, and Tajribah works on any other store with a single embed line on the product page.' } },
      { q: { ar: 'هل تُبطئ تجربة صفحة المنتج؟', en: 'Will Tajribah slow down my product page?' },
        a: { ar: 'يُحمَّل الزر من شبكة توزيع محتوى بحجم صغير، ولا يُحمَّل استوديو التجربة ونموذج تحديد المعصم إلا حين يضغط العميل على الزر.',
             en: 'The button loads from a CDN and is small. The try-on studio and the wrist-detection model load only when a shopper presses the button.' } },
      { q: { ar: 'هل يمكنني تجربة الخدمة قبل الاشتراك؟', en: 'Can I try it before subscribing?' },
        a: { ar: 'نعم. احجز عرضًا وسنجهّز التجربة على منتج من متجرك لتراها في صفحة منتج حقيقية.',
             en: 'Yes. Book a demo and we will set up a try-on on one of your products so you can see it on a real product page.' } },
      { q: { ar: 'ما الفئات المتاحة الآن؟', en: 'Which categories are available now?' },
        a: { ar: 'الساعات متاحة في العرض التجريبي. الخواتم والأساور والقلائد والنظارات والحقائب على خارطة الطريق.',
             en: 'Watches are available in the live demo. Rings, bracelets, necklaces, eyewear and bags are on the roadmap.' } },
    ],
  },
  {
    title: { ar: 'للمتسوّقين', en: 'For shoppers' },
    items: [
      { q: { ar: 'هل أحتاج إلى تثبيت تطبيق؟', en: 'Do I need to install an app?' },
        a: { ar: 'لا. تعمل التجربة في متصفح الجوال أو الحاسوب داخل صفحة المنتج.', en: 'No. Try-on runs in your phone or computer browser, inside the product page.' } },
      { q: { ar: 'ما مدى دقة المقاس؟', en: 'How accurate is the size?' },
        a: { ar: 'المقارنة بالحجم والعرض على العارضة مبنيان على أبعاد المنتج الحقيقية بالمليمتر. أما التجربة على صورتك فدليل تقريبي، لأن صورة واحدة لا تكفي لقياس معصمك بدقة.',
             en: 'Size comparison and the on-model view are built from the product’s real millimetre dimensions. Trying it on your own photo is a guide, because a single photo cannot measure your wrist exactly.' } },
      { q: { ar: 'لماذا لم يُحدَّد معصمي تلقائيًا؟', en: 'Why wasn’t my wrist found automatically?' },
        a: { ar: 'يحتاج النموذج إلى صورة واضحة تظهر فيها اليد كاملة وجزء من الساعد بإضاءة جيدة. وإن لم يجده، استخدم «ضبط على المعصم» وحدّد حافتي المعصم بنقرتين.',
             en: 'The model needs a clear, well-lit photo showing your whole hand and part of your forearm. If it can’t find your wrist, use “Fit to wrist” and mark its two edges with two taps.' } },
    ],
  },
  {
    title: { ar: 'الخصوصية', en: 'Privacy' },
    items: [
      { q: { ar: 'هل تُحفظ صورتي؟', en: 'Is my photo stored?' },
        a: { ar: 'الصورة التي ترفعها تُحلَّل داخل متصفحك ولا تُرسل إلى خوادمنا. وإن نقلتها من جوالك عبر رمز QR، تُحفظ مؤقتًا وتُحذف فور استلامها أو بعد 30 دقيقة كحد أقصى.',
             en: 'A photo you upload is analysed inside your browser and is not sent to our servers. If you send it from your phone with a QR code, it is held briefly and deleted as soon as it arrives, or after 30 minutes at most.' } },
      { q: { ar: 'هل تستخدمون التعرّف على الوجه؟', en: 'Do you use facial recognition?' },
        a: { ar: 'لا. نحدّد موضع اليد والمعصم فقط لوضع المنتج، ولا نتعرّف على الأشخاص ولا نحفظ أي بصمات حيوية.',
             en: 'No. We locate the hand and wrist only to place the product. We do not identify people and do not store biometric templates.' } },
    ],
  },
  {
    title: { ar: 'الفوترة', en: 'Billing' },
    items: [
      { q: { ar: 'هل الأسعار شاملة للضريبة؟', en: 'Do prices include VAT?' },
        a: { ar: 'لا. تُضاف ضريبة القيمة المضافة عند الدفع، وتصلك فاتورة ضريبية إلكترونية مع كل عملية.', en: 'No. VAT is added at checkout, and you receive an electronic tax invoice for every payment.' } },
      { q: { ar: 'هل يمكنني الإلغاء في أي وقت؟', en: 'Can I cancel at any time?' },
        a: { ar: 'نعم. يسري الإلغاء في نهاية فترة الفوترة الحالية. التفاصيل في سياسة الإلغاء والاسترداد.', en: 'Yes. Cancellation takes effect at the end of the current billing period. Details are in the cancellation and refund policy.' } },
    ],
  },
];

/** Question list, reused on the home page (with a limit). */
export function FAQ({ limit }: { limit?: number }) {
  const { lang } = useLang();
  const items = GROUPS.flatMap((g) => g.items).slice(0, limit ?? Infinity);
  return (
    <div className="faq">
      {items.map((it) => (
        <details key={it.q.en} className="qa">
          <summary><span>{pick(it.q, lang)}</span><Plus size={18} aria-hidden /></summary>
          <p>{pick(it.a, lang)}</p>
        </details>
      ))}
    </div>
  );
}

export default function FaqPage() {
  const { lang, t } = useLang();
  return (
    <Shell current="/faq">
      <PageHero eyebrow={t('الأسئلة الشائعة', 'FAQ')} title={t('إجابات مباشرة', 'Straight answers')}
        lead={t('للمتاجر والمتسوّقين، عن طريقة العمل والدقة والخصوصية والفوترة.', 'For stores and shoppers — how it works, accuracy, privacy and billing.')} />
      <section className="sec">
        <div className="wrap narrow faq-groups">
          {GROUPS.map((g) => (
            <div key={g.title.en} className="faq-group">
              <h2>{pick(g.title, lang)}</h2>
              <div className="faq">
                {g.items.map((it) => (
                  <details key={it.q.en} className="qa">
                    <summary><span>{pick(it.q, lang)}</span><Plus size={18} aria-hidden /></summary>
                    <p>{pick(it.a, lang)}</p>
                  </details>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
      <CtaBand />
    </Shell>
  );
}
