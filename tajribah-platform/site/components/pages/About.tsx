'use client';

import { useLang } from '@site/lib/i18n';
import { useSiteEnv } from '@site/lib/site-env';
import { Shell } from '@site/components/site/chrome';
import { CtaBand, Frame, PageHero, SectionHead } from '@site/components/site/ui';

export default function About() {
  const { t } = useLang();
  const { asset } = useSiteEnv();

  const principles = [
    { h: t('الدقة قبل الإبهار', 'Accuracy before spectacle'), p: t('نبدأ من أبعاد المنتج الحقيقية بالمليمتر. العرض الجميل الذي يكذب في المقاس يزيد المرتجعات ولا يقللها.', 'We start from the product’s real millimetre dimensions. A beautiful view that lies about size creates returns instead of preventing them.') },
    { h: t('الخصوصية افتراضيًا', 'Private by default'), p: t('ما يمكن أن يحدث على جهاز العميل يحدث عليه. لا نجمع صورًا لا نحتاجها، ولا نحتفظ بما لا يلزم.', 'What can happen on the shopper’s device happens there. We don’t collect photos we don’t need, or keep what isn’t required.') },
    { h: t('العربية أولًا', 'Arabic first'), p: t('نصمّم للقارئ العربي من اليمين إلى اليسار، ثم نضيف الإنجليزية. لا العكس.', 'We design for the Arabic reader, right to left, then add English — not the other way round.') },
    { h: t('في متناول التاجر', 'Within a merchant’s reach'), p: t('تبدأ الباقات من 99 ريالًا، لأن التجربة الافتراضية لا ينبغي أن تكون حكرًا على العلامات الكبيرة.', 'Plans start at 99 riyals, because virtual try-on should not be reserved for the biggest brands.') },
  ];

  return (
    <Shell current="/about">
      <PageHero eyebrow={t('من نحن', 'About')}
        title={t('اسمنا هو ما نقدّمه', 'Our name is what we do')}
        lead={t('«تجربة» في العربية تعني الخبرة التي تعيشها، وتعني أيضًا أن تجرّب الشيء قبل أن تقتنيه. نبني الاثنين معًا لمتاجر الساعات والمجوهرات والإكسسوارات.',
          '“Tajribah” — تجربة — means an experience you live through, and also trying something on before you own it. We build both, for watch, jewellery and accessory stores.')} />

      <section className="sec">
        <div className="wrap split about-split">
          <div>
            <SectionHead eyebrow={t('لماذا بدأنا', 'Why we started')}
              title={t('المتسوّق عبر الإنترنت لا يستطيع أن يمسك الساعة بيده', 'Online shoppers can’t hold the watch in their hand')} />
            <div className="prose">
              <p>{t('في المتجر، يلبس العميل الساعة وينظر إلى معصمه، ثم يقرر. على الإنترنت، يرى صورة مكبّرة على خلفية بيضاء ورقمًا بالمليمتر لا يعني له الكثير. فيتردد، أو يشتري ويعيد.',
                'In a shop, a customer puts the watch on, looks at their wrist, and decides. Online, they see an enlarged photo on a white background and a millimetre figure that means little to them. So they hesitate — or buy and return.')}</p>
              <p>{t('تجربة تعيد تلك اللحظة إلى صفحة المنتج: القطعة بحجمها الحقيقي، على معصم يشبه معصم العميل، أو على صورته هو، وبجانب أشياء يعرف حجمها جيدًا.',
                'Tajribah brings that moment back to the product page: the piece at its true size, on a wrist like the shopper’s own or on their own photo, next to things whose size they already know.')}</p>
              <p>{t('نبنيها للسوق السعودي أولًا: بالعربية، ومع المنصات التي يبيع عليها التجار هنا، وبأسعار تناسب المتاجر الصغيرة قبل الكبيرة.',
                'We build it for the Saudi market first: in Arabic, with the platforms merchants here sell on, at prices that suit small stores as well as large ones.')}</p>
            </div>
          </div>
          <Frame className="about-logo">
            <img src={asset('/brand/tajribah-logo.png')} alt="تجربة Tajribah" width={640} height={714} />
          </Frame>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap">
          <SectionHead eyebrow={t('ما نؤمن به', 'What we believe')} title={t('أربعة مبادئ نبني عليها', 'Four principles we build on')} />
          <div className="grid-2 principles">
            {principles.map((p) => <article key={p.h}><h3>{p.h}</h3><p>{p.p}</p></article>)}
          </div>
        </div>
      </section>

      <CtaBand />
    </Shell>
  );
}
