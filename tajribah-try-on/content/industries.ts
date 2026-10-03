import type { Bi } from '@/lib/lang';
import type { FeatureSlug } from './features';

/**
 * A page per kind of store (Track M, M6): what the size question looks like in that category,
 * which ways to try work for it **today**, what the merchant measures, and what is not built yet.
 *
 * Availability follows the feature pages (`content/features.ts`), which describe the studio as
 * built: on-model and on-your-photo cover watches and bracelets (hands only); true-size
 * comparison covers any small product with a size in millimetres. Face, neck, ear and on-body
 * try-on (eyewear, necklaces, earrings, bags) is P5 — marked `soon`, never implied.
 */
export type IndustrySlug = 'watches' | 'jewellery' | 'eyewear' | 'bags';

export type Industry = {
  slug: IndustrySlug;
  nav: Bi;
  hero: { title: Bi; lead: Bi };
  /** The size question as a shopper in this category asks it. */
  question: Bi;
  problem: Bi[];
  modes: { feature: FeatureSlug | null; label: Bi; status: 'now' | 'soon'; note: Bi }[];
  measure: Bi[];
  faq: { q: Bi; a: Bi }[];
};

export const INDUSTRY_ORDER: IndustrySlug[] = ['watches', 'jewellery', 'eyewear', 'bags'];

export const INDUSTRIES: Record<IndustrySlug, Industry> = {
  watches: {
    slug: 'watches',
    nav: { ar: 'متاجر الساعات', en: 'Watch stores' },
    hero: {
      title: { ar: 'لمتاجر الساعات: أجب عن سؤال المقاس قبل أن يُطرح', en: 'For watch stores: answer the size question before it is asked' },
      lead: { ar: 'الساعات هي ما بُنيت له تجربة أولًا. كل طرق التجربة الأربع تعمل على ساعاتك اليوم.', en: 'Watches are what Tajribah was built for first. All four ways to try work on your watches today.' },
    },
    question: { ar: '«هل 42 مم كبيرة على معصمي؟»', en: '“Is 42 mm too big for my wrist?”' },
    problem: [
      { ar: 'قطر العلبة رقم يعرفه هواة الساعات ولا يتخيّله أغلب المشترين. صورة المنتج المكبّرة تجعل كل ساعة تبدو بالحجم نفسه.', en: 'Case diameter is a number collectors know and most buyers cannot picture. An enlarged product photo makes every watch look the same size.' },
      { ar: 'والفرق بين 38 و42 مم يبدو صغيرًا على الورق، لكنه على معصم نحيف هو الفرق بين ساعة مناسبة وساعة تُرجع.', en: 'The difference between 38 and 42 mm looks small on paper, but on a slim wrist it is the difference between a watch that fits and one that comes back.' },
    ],
    modes: [
      { feature: 'on-model', label: { ar: 'على العارضة', en: 'On model' }, status: 'now', note: { ar: 'الساعة على معصم حقيقي بمقاسها الصحيح.', en: 'The watch on a real wrist at its true size.' } },
      { feature: 'on-me', label: { ar: 'على صورتك', en: 'On your photo' }, status: 'now', note: { ar: 'على صورة يد العميل نفسه، مع تحديد المعصم تلقائيًا.', en: 'On a photo of the shopper’s own hand, with the wrist found automatically.' } },
      { feature: 'true-size', label: { ar: 'قارن الحجم', en: 'Compare size' }, status: 'now', note: { ar: 'بجانب ريال سعودي وإيربودز وآيفون بالمقياس نفسه.', en: 'Beside a riyal, AirPods and an iPhone at one scale.' } },
      { feature: 'phone-handoff', label: { ar: 'من الحاسوب إلى الجوال', en: 'Desktop to phone' }, status: 'now', note: { ar: 'يلتقط صورة معصمه بجواله وهو يتصفح على الحاسوب.', en: 'Take the wrist photo with a phone while browsing on a computer.' } },
    ],
    measure: [
      { ar: 'قطر العلبة دون التاج، بالمليمتر', en: 'Case diameter without the crown, in millimetres' },
      { ar: 'عرض السوار عند العلبة', en: 'Strap width at the case' },
      { ar: 'صورة للساعة بخلفية شفافة (PNG)', en: 'A cut-out of the watch (transparent PNG)' },
    ],
    faq: [
      { q: { ar: 'هل تعمل مع الساعات الذكية؟', en: 'Does it work for smartwatches?' }, a: { ar: 'نعم، بالطريقة نفسها: أدخل عرض العلبة وارتفاعها وعرض السوار، وارفع صورة الساعة بخلفية شفافة.', en: 'Yes, the same way: enter the case width and height and the strap width, and upload a cut-out of the watch.' } },
      { q: { ar: 'وماذا عن الساعات المستطيلة؟', en: 'What about rectangular watches?' }, a: { ar: 'تعمل. نستخدم العرض والارتفاع معًا، فلا نفترض أن كل علبة دائرية.', en: 'They work. We use width and height together, so no case is assumed to be round.' } },
    ],
  },
  jewellery: {
    slug: 'jewellery',
    nav: { ar: 'متاجر المجوهرات', en: 'Jewellery stores' },
    hero: {
      title: { ar: 'لمتاجر المجوهرات: قطع صغيرة، وحجم يصعب تخيّله', en: 'For jewellery stores: small pieces, hard-to-picture sizes' },
      lead: { ar: 'الأساور تُجرَّب على المعصم اليوم، وكل قطعة لها مقاس بالمليمتر تُقارن بحجمها الحقيقي. التجربة على الرقبة والأذن لم تُبنَ بعد.', en: 'Bracelets can be tried on the wrist today, and any piece with a size in millimetres can be compared at true size. Neck and ear try-on is not built yet.' },
    },
    question: { ar: '«هل القلادة أصغر مما تبدو في الصورة؟»', en: '“Is the pendant smaller than it looks in the photo?”' },
    problem: [
      { ar: 'صور المجوهرات تُلتقط عن قرب لتُظهر اللمعان والتفاصيل، فتبدو القطعة أكبر بكثير من حقيقتها. المفاجأة عند الاستلام شكوى شائعة في هذه الفئة.', en: 'Jewellery is photographed up close to show sparkle and detail, so a piece looks far larger than it is. Surprise on delivery is a familiar complaint in this category.' },
    ],
    modes: [
      { feature: 'on-model', label: { ar: 'الأساور على العارضة', en: 'Bracelets on model' }, status: 'now', note: { ar: 'السوار على معصم حقيقي بمقاسه.', en: 'The bracelet on a real wrist at its size.' } },
      { feature: 'on-me', label: { ar: 'الأساور على صورتك', en: 'Bracelets on your photo' }, status: 'now', note: { ar: 'على صورة يد العميل.', en: 'On a photo of the shopper’s hand.' } },
      { feature: 'true-size', label: { ar: 'قارن الحجم — أي قطعة', en: 'Compare size — any piece' }, status: 'now', note: { ar: 'خواتم وقلائد وأقراط بجانب ريال سعودي بالمقياس نفسه.', en: 'Rings, pendants and earrings beside a riyal coin at one scale.' } },
      { feature: null, label: { ar: 'القلائد والأقراط على الجسم', en: 'Necklaces and earrings on the body' }, status: 'soon', note: { ar: 'تحتاج تتبّع الرقبة والأذن، وهو ضمن خطة التوسّع وليس متاحًا اليوم.', en: 'Needs neck and ear tracking — in the expansion plan, not available today.' } },
    ],
    measure: [
      { ar: 'للخاتم: القطر الداخلي', en: 'Rings: inner diameter' },
      { ar: 'للقلادة: عرض وارتفاع الدلاية (والسلسلة تُذكر في الوصف)', en: 'Pendants: pendant width and height (chain length stays in the description)' },
      { ar: 'للسوار: القطر الداخلي والعرض', en: 'Bracelets: inner diameter and width' },
    ],
    faq: [
      { q: { ar: 'هل يظهر لمعان الأحجار؟', en: 'Does the sparkle show?' }, a: { ar: 'نعرض صورتك أنت للقطعة، فيظهر فيها ما تظهره صورتك. نحن نضيف الحجم الصحيح، لا مؤثرات.', en: 'We show your own photo of the piece, so it shows what your photo shows. We add the true size, not effects.' } },
      { q: { ar: 'متى تُتاح التجربة على الرقبة؟', en: 'When will neck try-on be available?' }, a: { ar: 'لا نعلن موعدًا قبل أن تعمل بدقة كافية على جوال متوسط. تواصل معنا لنبلغك حين تُتاح.', en: 'We will not announce a date before it works accurately on a mid-range phone. Contact us and we will tell you when it is ready.' } },
    ],
  },
  eyewear: {
    slug: 'eyewear',
    nav: { ar: 'متاجر النظارات', en: 'Eyewear stores' },
    hero: {
      title: { ar: 'لمتاجر النظارات: عرض الإطار بحجمه الحقيقي', en: 'For eyewear stores: frame width at its true size' },
      lead: { ar: 'في العرض التجريبي الآن: الإطار على وجه حقيقي بعرضه الحقيقي، وبجانب أشياء يعرفها الجميع. تجهيز إطاراتك من لوحة التحكم يأتي تاليًا، والتجربة على صورة العميل بعده.', en: 'In the live demo now: the frame on a real face at its real width, and beside familiar objects. Setting up your own frames in the dashboard comes next, the shopper’s own photo after that.' },
    },
    question: { ar: '«هل الإطار عريض على وجهي؟»', en: '“Is this frame too wide for my face?”' },
    problem: [
      { ar: 'مقاسات النظارات تُكتب بثلاثة أرقام (عرض العدسة، الجسر، الذراع) لا يعرف أغلب المشترين معناها. العرض الكلي للإطار هو ما يقرر إن كانت مناسبة.', en: 'Eyewear sizes are written as three numbers (lens width, bridge, temple) most buyers cannot read. The frame’s total width is what decides whether it fits.' },
    ],
    modes: [
      { feature: 'true-size', label: { ar: 'قارن الحجم', en: 'Compare size' }, status: 'now', note: { ar: 'الإطار بعرضه الحقيقي بجانب آيفون وسماعات إيربودز.', en: 'The frame at its true width beside an iPhone and AirPods.' } },
      { feature: null, label: { ar: 'على وجه النموذج', en: 'On a model’s face' }, status: 'soon', note: { ar: 'جرّبه الآن في العرض التجريبي: صورة حقيقية، والمقياس من المسافة بين الحدقتين. تجهيز إطاراتك من لوحة التحكم يأتي تاليًا.', en: 'Try it now in the live demo: a real photo, sized from the distance between the pupils. Setting up your own frames in the dashboard comes next.' } },
      { feature: null, label: { ar: 'على صورة العميل', en: 'On the shopper’s photo' }, status: 'soon', note: { ar: 'تحديد الوجه في صورة العميل ضمن خطة التوسّع. لا نعرضه قبل أن يكون دقيقًا وخاصًا على جهاز العميل.', en: 'Finding the face in the shopper’s photo is in the expansion plan. We will not show it before it is accurate and private on the shopper’s device.' } },
    ],
    measure: [
      { ar: 'العرض الكلي للإطار بالمليمتر', en: 'Total frame width in millimetres' },
      { ar: 'ارتفاع العدسة', en: 'Lens height' },
      { ar: 'صورة أمامية للإطار بخلفية شفافة', en: 'A front cut-out of the frame' },
    ],
    faq: [
      { q: { ar: 'كيف يكون الإطار بحجمه الحقيقي على الوجه؟', en: 'How is the frame its real size on the face?' }, a: { ar: 'نقيس صورة النموذج من المسافة بين حدقتي العينين (نحو 62 مم عند البالغين)، ثم نرسم الإطار بعرضه بالمليمتر على المقياس نفسه. تجربة بحجم غير دقيق تعطي العميل ثقة في نتيجة خاطئة، ولذلك نقيس ولا نقدّر بالعين.', en: 'We measure the model photo from the distance between the pupils (about 62 mm in adults), then draw the frame at its width in millimetres on the same scale. Try-on at an inaccurate size gives the shopper confidence in a wrong answer, so we measure rather than judge by eye.' } },
    ],
  },
  bags: {
    slug: 'bags',
    nav: { ar: 'متاجر الحقائب', en: 'Bag stores' },
    hero: {
      title: { ar: 'لمتاجر الحقائب الصغيرة: «هل يدخل جوالي؟»', en: 'For small-bag stores: “Will my phone fit?”' },
      lead: { ar: 'اليوم: الحقائب الصغيرة والمحافظ بجانب آيفون بالمقياس نفسه. تجربة الحقيبة على الجسم لم تُبنَ بعد.', en: 'Today: small bags, clutches and wallets beside an iPhone at one scale. On-body bag try-on is not built yet.' },
    },
    question: { ar: '«هل يتسع لجوالي ومفاتيحي؟»', en: '“Does it fit my phone and keys?”' },
    problem: [
      { ar: 'أبعاد الحقيبة بالسنتيمتر لا تجيب عن السؤال الحقيقي: ماذا يدخل فيها؟ مقارنتها بجوال يعرفه العميل تجيب عنه في نظرة.', en: 'A bag’s dimensions in centimetres do not answer the real question: what goes in it? Seeing it next to a phone the shopper knows answers it at a glance.' },
    ],
    modes: [
      { feature: 'true-size', label: { ar: 'قارن الحجم', en: 'Compare size' }, status: 'now', note: { ar: 'الحقائب الصغيرة والمحافظ وحقائب اليد الصغيرة بجانب آيفون.', en: 'Small bags, wallets and clutches beside an iPhone.' } },
      { feature: null, label: { ar: 'الحقيبة على الجسم', en: 'The bag on the body' }, status: 'soon', note: { ar: 'في آخر خطة التوسّع، بعد الساعات والمجوهرات والنظارات.', en: 'Last in the expansion plan, after watches, jewellery and eyewear.' } },
    ],
    measure: [
      { ar: 'العرض والارتفاع من الأمام بالمليمتر', en: 'Front width and height in millimetres' },
      { ar: 'صورة أمامية بخلفية شفافة', en: 'A front cut-out' },
    ],
    faq: [
      { q: { ar: 'وماذا عن الحقائب الكبيرة؟', en: 'What about large bags?' }, a: { ar: 'المراجع الحالية صغيرة (ريال، إيربودز، آيفون)، فالمقارنة مفيدة للحقائب الصغيرة أكثر. إضافة مرجع أكبر مسألة صورة ومقاس، أخبرنا إن احتجته.', en: 'Today’s references are small (a riyal, AirPods, an iPhone), so the comparison helps small bags most. Adding a larger reference is a matter of a photo and a size — tell us if you need one.' } },
    ],
  },
};

export const industry = (slug: string) => (slug in INDUSTRIES ? INDUSTRIES[slug as IndustrySlug] : undefined);
