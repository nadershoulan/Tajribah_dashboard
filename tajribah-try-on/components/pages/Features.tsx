'use client';

import { BarChart3, Box, Camera, Code2, Gauge, Hand, KeyboardIcon, Languages, LockKeyhole, QrCode, RefreshCw, Ruler } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { SiteLink, useSiteEnv } from '@/lib/site-env';
import { FEATURE_PAGES } from '@/content/features';
import { Forward } from '@/components/site/chrome';
import { REFERENCES } from '@/lib/demo-product';
import { Shell } from '@/components/site/chrome';
import { Checks, CtaBand, Frame, PageHero, SectionHead, Tag } from '@/components/site/ui';

export default function Features() {
  const { t } = useLang();
  const { asset } = useSiteEnv();

  const modes = [
    {
      icon: Hand, tag: true, slug: 'on-model' as const,
      h: t('على النموذج', 'On model'),
      p: t('صور حقيقية لمعصم عارضة، والقطعة عليها بالحجم الصحيح. يختار العميل الصورة الأقرب له، ويحرّك الساعة على المعصم حتى تستقر في مكانها.',
        'Real model photography with the piece on it at the right size. Shoppers pick the shot closest to them and slide the watch along the wrist until it sits right.'),
      points: [t('صورتان: المعصم عن قرب وإطلالة يومية', 'Two shots: wrist close-up and lifestyle'), t('تحريك الساعة على المعصم', 'Slide the watch along the wrist'), t('تدوير وتكبير', 'Rotate and zoom')],
    },
    {
      icon: Camera, tag: true, slug: 'on-me' as const,
      h: t('عليّ', 'On me'),
      p: t('يرفع العميل صورة لظهر يده أو يلتقطها بجواله. نموذج رؤية داخل المتصفح يحدّد المعصم ويضع القطعة بزاويتها، ويمكن ضبطها يدويًا بنقرتين.',
        'The shopper uploads or takes a photo of the back of their hand. An in-browser vision model finds the wrist and places the piece at its angle; two taps fine-tune it by hand.'),
      points: [t('تحديد المعصم تلقائيًا', 'Automatic wrist detection'), t('ضبط يدوي بتحديد حافتي المعصم', 'Manual fit by marking both wrist edges'), t('حفظ الصورة النهائية', 'Save the final image')],
    },
    {
      icon: Ruler, tag: true, slug: 'true-size' as const,
      h: t('قارن الحجم', 'Compare size'),
      p: t('القطعة بجانب أشياء يعرفها الجميع، كلها بالمقياس نفسه. يستطيع العميل سحب أي منها وتدويره، والتكبير يغيّر حجم العنصرين معًا.',
        'The piece next to things everyone knows, all at one scale. Shoppers can drag and rotate either item, and zoom scales both together.'),
      points: [t('ريال سعودي، إيربودز، آيفون 15', 'A Saudi riyal, AirPods, an iPhone 15'), t('المليمتر أو البوصة', 'Millimetres or inches'), t('خطوط قياس على القطعة', 'Measurement lines on the piece')],
    },
    {
      icon: QrCode, tag: true, slug: 'phone-handoff' as const,
      h: t('من الحاسوب إلى الجوال', 'Desktop to phone'),
      p: t('من يتصفح على الحاسوب يمسح رمز QR، فيلتقط صورة معصمه بكاميرا جواله، وتظهر النتيجة على الشاشة الكبيرة خلال ثوانٍ.',
        'Shoppers browsing on a computer scan a QR code, take the wrist photo with their phone camera, and see the result on the big screen within seconds.'),
      points: [t('رمز صالح 30 دقيقة', 'Code valid for 30 minutes'), t('تُحذف الصورة فور وصولها', 'Photo deleted on arrival'), t('رمز جلسة عشوائي بطول 128 بت', 'Random 128-bit session code')],
    },
  ];

  const merchant = [
    { icon: RefreshCw, h: t('مزامنة الكتالوج', 'Catalogue sync'), p: t('المنتجات والأسعار والمخزون تُستورد من منصة متجرك وتبقى محدّثة.', 'Products, prices and stock import from your store platform and stay current.') },
    { icon: Box, h: t('نماذج ثلاثية الأبعاد من الصور', '3D from photos'), p: t('ارفع صورًا من الأمام والجانب والخلف، ونولّد نموذجًا للعرض ثلاثي الأبعاد والواقع المعزز.', 'Upload front, side and back photos and we generate a model for 3D and AR viewing.') },
    { icon: BarChart3, h: t('تحليلات الأثر', 'Impact analytics'), p: t('الجلسات والتجارب ونسبة التحويل والمنتجات الأكثر تجربة، في لوحة واحدة.', 'Sessions, try-ons, conversion and most-tried products, in one dashboard.') },
    { icon: Code2, h: t('زر يناسب متجرك', 'A button that fits your store'), p: t('لون الزر ونصه وموضعه قابلة للتعديل ليطابق هوية متجرك.', 'Button colour, text and position adjust to match your store’s identity.') },
  ];

  const quality = [
    { icon: Languages, h: t('عربية أولًا', 'Arabic first'), p: t('كل شاشة مصممة من اليمين إلى اليسار، والإنجليزية متاحة بضغطة.', 'Every screen is designed right-to-left, with English one tap away.') },
    { icon: LockKeyhole, h: t('الخصوصية افتراضيًا', 'Private by default'), p: t('تحليل الصور على جهاز العميل، دون تعرّف على الوجوه أو بصمات حيوية.', 'Photo analysis on the shopper’s device, with no facial recognition or biometric templates.') },
    { icon: Gauge, h: t('لا تُبطئ صفحتك', 'Won’t slow your page'), p: t('يُحمَّل الاستوديو ونموذج الرؤية فقط حين يضغط العميل على الزر.', 'The studio and vision model load only when a shopper presses the button.') },
    { icon: KeyboardIcon, h: t('سهل الوصول', 'Accessible'), p: t('تحكّم كامل بلوحة المفاتيح ووصف مقروء لكل عنصر تفاعلي.', 'Full keyboard control and readable labels on every interactive element.') },
  ];

  return (
    <Shell current="/features">
      <PageHero eyebrow={t('المزايا', 'Features')}
        title={t('كل ما يحتاجه عميلك ليقرر المقاس', 'Everything a shopper needs to decide on size')}
        lead={t('ثلاث طرق للتجربة تجيب عن أسئلة المتسوّق، وأدوات للتاجر تجعل إضافتها إلى متجره أمرًا بسيطًا.',
          'Three ways to try that answer the shopper’s questions, and merchant tools that make adding them to a store simple.')} />

      <section className="sec">
        <div className="wrap">
          <SectionHead eyebrow={t('للمتسوّق', 'For shoppers')} title={t('طرق التجربة', 'Ways to try')} />
          <div className="mode-rows">
            {modes.map(({ icon: Icon, h, p, points, tag, slug }) => (
              <article key={h} className="mode-row">
                <span className="f-icon lg"><Icon size={24} aria-hidden /></span>
                <div>
                  <h3>{h} {tag && <Tag kind="live">{t('في العرض التجريبي', 'In the live demo')}</Tag>}</h3>
                  <p>{p}</p>
                  <Checks items={points} />
                  <SiteLink href={`/features/${slug}`} className="link-more">
                    {t(`كيف تعمل «${FEATURE_PAGES[slug].nav.ar}»`, `How “${FEATURE_PAGES[slug].nav.en}” works`)}<Forward size={16} />
                  </SiteLink>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap split">
          <div>
            <SectionHead eyebrow={t('مراجع يعرفها الجميع', 'References everyone knows')}
              title={t('المقاس يُفهم بالمقارنة', 'Size makes sense by comparison')}
              lead={t('«29 مم» رقم. أما «أكبر قليلًا من ريال» فصورة يفهمها العميل فورًا. لذلك نضع القطعة بجانب أشياء يحملها كل يوم.',
                '“29 mm” is a number. “A little bigger than a riyal” is a picture a shopper understands at once. So we put the piece next to things they carry every day.')} />
          </div>
          <Frame className="refs-frame">
            <div className="refs-row">
              {(['riyal', 'airpods', 'iphone'] as const).map((id) => (
                <figure key={id} style={{ ['--w' as string]: REFERENCES[id].w, ['--h' as string]: REFERENCES[id].h }}>
                  <img src={asset(REFERENCES[id].src)} alt="" />
                  <figcaption>{t(REFERENCES[id].name.ar, REFERENCES[id].name.en)}<bdi dir="ltr">{REFERENCES[id].w} × {REFERENCES[id].h} mm</bdi></figcaption>
                </figure>
              ))}
            </div>
          </Frame>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <SectionHead eyebrow={t('للتاجر', 'For merchants')} title={t('أدوات تختصر العمل', 'Tools that save the work')} />
          <div className="grid-4">
            {merchant.map(({ icon: Icon, h, p }) => (
              <article key={h} className="feature"><span className="f-icon"><Icon size={20} aria-hidden /></span><h3>{h}</h3><p>{p}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap">
          <SectionHead eyebrow={t('الجودة', 'Quality')} title={t('ما لا يظهر في العرض، لكنه يصنع الفرق', 'What doesn’t show in a demo, but matters')} />
          <div className="grid-4">
            {quality.map(({ icon: Icon, h, p }) => (
              <article key={h} className="feature"><span className="f-icon"><Icon size={20} aria-hidden /></span><h3>{h}</h3><p>{p}</p></article>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </Shell>
  );
}
