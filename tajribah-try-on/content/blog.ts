import type { Bi } from '@/lib/lang';

/**
 * Blog (Track M, M7). Written by the Tajribah team for merchants selling watches, jewellery and
 * accessories online in Saudi Arabia. The posts argue from how the product works and from
 * practice — they cite no statistics, because an invented figure presented as research is not
 * something this site publishes. Dates are publication dates.
 */
export type BlogPost = {
  slug: string;
  date: string; // YYYY-MM-DD
  minutes: number;
  tag: Bi;
  title: Bi;
  excerpt: Bi;
  sections: { heading?: Bi; paragraphs: Bi[] }[];
};

const TEAM: Bi = { ar: 'فريق تجربة', en: 'The Tajribah team' };
export const BLOG_AUTHOR = TEAM;

export const BLOG_POSTS: BlogPost[] = [
  {
    slug: 'the-size-question', date: '2026-09-24', minutes: 5,
    tag: { ar: 'تجربة المتسوّق', en: 'Shopper experience' },
    title: { ar: '«كم حجمها على يدي؟» — السؤال الذي يوقف عملية الشراء', en: '“How big is it on my wrist?” — the question that stops a purchase' },
    excerpt: { ar: 'صورة المنتج الاحترافية تُظهر كل تفصيل إلا الشيء الذي يقرر به العميل: الحجم.', en: 'A professional product photo shows every detail except the one the shopper decides on: size.' },
    sections: [
      { paragraphs: [
        { ar: 'في المتجر الحقيقي، يرفع العميل الساعة ويضعها على معصمه، فيعرف خلال ثانية إن كانت كبيرة أو صغيرة عليه. في المتجر الإلكتروني تغيب هذه الثانية. تُعرض الساعة مكبّرة على خلفية بيضاء، بصورة تُظهر النقوش والمينا والعقارب — وتُخفي الحجم تمامًا.', en: 'In a real shop, the customer picks the watch up, puts it on their wrist, and knows within a second whether it is too big or too small. Online, that second is missing. The watch is shown enlarged on a white background, in a photo that shows the engraving, the dial and the hands — and hides the size completely.' },
        { ar: 'قطر العلبة مكتوب في المواصفات: 41 مم. لكن ما معنى 41 مم لعميل لا يحمل مسطرة؟ الرقم دقيق، لكنه لا يجيب عن السؤال الحقيقي: كيف ستبدو على يدي أنا؟', en: 'The case diameter is in the specs: 41 mm. But what does 41 mm mean to a shopper who is not holding a ruler? The number is precise, but it does not answer the real question: how will it look on my wrist?' },
      ] },
      { heading: { ar: 'ما الذي يحدث حين لا يجد العميل الجواب', en: 'What happens when the shopper cannot find the answer' }, paragraphs: [
        { ar: 'يتردد. يفتح التقييمات بحثًا عن صورة من عميل آخر. يسأل في المحادثة. يؤجّل. أو يشتري مقاسين ليُرجع أحدهما — وهذا أغلى الخيارات على التاجر، لأن الإرجاع يعني شحنتين وتغليفًا ومنتجًا قد لا يعود للبيع بالحالة نفسها.', en: 'They hesitate. They open the reviews looking for another customer’s photo. They ask in chat. They put it off. Or they buy two sizes to return one — the most expensive option for the merchant, because a return means two shipments, repacking, and a product that may not go back on sale in the same condition.' },
      ] },
      { heading: { ar: 'أجيبوا عن السؤال في صفحة المنتج نفسها', en: 'Answer the question on the product page itself' }, paragraphs: [
        { ar: 'الحل ليس صورًا أكثر، بل مرجع يعرفه العميل: القطعة على معصم حقيقي بالمقياس الصحيح، أو بجانب ريال سعودي وسماعات إيربودز وجوال آيفون بالمقياس نفسه. حين يرى العميل الساعة بجانب شيء يحمله كل يوم، يفهم الحجم دون أن يقرأ رقمًا.', en: 'The fix is not more photos but a reference the shopper already knows: the piece on a real wrist at the right scale, or next to a Saudi riyal, AirPods and an iPhone at the same scale. When shoppers see the watch beside something they carry every day, they understand the size without reading a number.' },
        { ar: 'وهذا بالضبط ما صُممت له تجربة: ثلاث طرق للإجابة عن سؤال واحد، داخل صفحة المنتج، دون تطبيق يثبّته العميل.', en: 'That is exactly what Tajribah is built for: three ways to answer one question, inside the product page, with nothing for the shopper to install.' },
      ] },
    ],
  },
  {
    slug: 'true-size-references', date: '2026-09-17', minutes: 4,
    tag: { ar: 'المنتج', en: 'Product' },
    title: { ar: 'لماذا نقارن الساعة بريال سعودي؟', en: 'Why we compare a watch to a Saudi riyal' },
    excerpt: { ar: 'كيف اخترنا الأشياء المرجعية، ولماذا يجب أن تكون كلها بالمقياس نفسه.', en: 'How we chose the reference objects, and why they must all share one scale.' },
    sections: [
      { paragraphs: [
        { ar: 'المقارنة بالحجم لا تعمل إلا إذا كان المرجع مألوفًا ودقيقًا. اخترنا ثلاثة أشياء يحملها معظم الناس في السعودية أو رأوها آلاف المرات: الريال المعدني، وعلبة سماعات إيربودز، وجوال آيفون. كل منها بأبعاده الحقيقية بالمليمتر.', en: 'Size comparison only works if the reference is familiar and exact. We chose three things most people in Saudi Arabia carry or have seen thousands of times: the riyal coin, an AirPods case and an iPhone — each at its real dimensions in millimetres.' },
      ] },
      { heading: { ar: 'مقياس واحد لكل شيء', en: 'One scale for everything' }, paragraphs: [
        { ar: 'حين يكبّر العميل الصورة، يكبر العنصران معًا. لو كبرت الساعة وحدها لفقدت المقارنة معناها. لذلك نرسم كل شيء على شبكة واحدة: كل 10 مم مسافة ثابتة على الشاشة، مهما كان مستوى التكبير.', en: 'When the shopper zooms, both items grow together. If only the watch grew, the comparison would mean nothing. So we draw everything on one grid: every 10 mm is a fixed distance on screen, whatever the zoom.' },
        { ar: 'ولهذا أيضًا نطلب من التاجر مقاس المنتج بالمليمتر، ولا نعرض المقارنة لمنتج بلا مقاس. مقارنة بمقاس تقريبي أسوأ من عدم المقارنة، لأنها تعطي العميل ثقة في رقم خاطئ.', en: 'It is also why we ask merchants for the product’s size in millimetres, and show no comparison for a product without one. A comparison with a guessed size is worse than none, because it gives the shopper confidence in a wrong number.' },
      ] },
    ],
  },
  {
    slug: 'private-by-design', date: '2026-09-10', minutes: 4,
    tag: { ar: 'الخصوصية', en: 'Privacy' },
    title: { ar: 'تجربة على المعصم دون أن تغادر الصورة جهاز العميل', en: 'Wrist try-on without the photo leaving the shopper’s device' },
    excerpt: { ar: 'لماذا نحلل الصورة داخل المتصفح، وما الذي لا نجمعه أبدًا.', en: 'Why we analyse the photo in the browser, and what we never collect.' },
    sections: [
      { paragraphs: [
        { ar: 'حين يلتقط العميل صورة لظهر يده، يعمل نموذج رؤية داخل متصفحه ليحدد موضع المعصم وزاويته. لا تُرسل الصورة إلى خوادمنا لهذا التحليل، ولا نستخدم التعرّف على الوجوه، ولا نحتفظ بأي بصمة حيوية.', en: 'When a shopper photographs the back of their hand, a vision model runs in their browser to find the wrist and its angle. The photo is not sent to our servers for that analysis; we use no facial recognition and keep no biometric template.' },
        { ar: 'الاستثناء الوحيد اختياري: من يتصفح على الحاسوب ويريد استخدام كاميرا جواله يمسح رمز QR، فتنتقل الصورة من الجوال إلى الشاشة عبر جلسة مؤقتة صالحة 30 دقيقة، وتُحذف الصورة فور وصولها.', en: 'The one exception is optional: a shopper on a computer who wants to use their phone’s camera scans a QR code, and the photo travels from phone to screen through a temporary session valid for 30 minutes — deleted as soon as it arrives.' },
      ] },
      { heading: { ar: 'لماذا يهم هذا التاجر', en: 'Why this matters to the merchant' }, paragraphs: [
        { ar: 'نظام حماية البيانات الشخصية في المملكة يجعل كل صورة شخصية مسؤولية. أسهل طريقة لحماية بيانات لا تحتاجها هي ألا تجمعها. هكذا صممنا التجربة منذ البداية، وهكذا نستطيع أن نقولها لعملائك بوضوح في سياسة خصوصية الكاميرا.', en: 'Saudi Arabia’s Personal Data Protection Law makes every personal photo a responsibility. The simplest way to protect data you do not need is not to collect it. That is how the try-on was designed from the start, and why we can say it plainly to your customers in our camera-privacy policy.' },
      ] },
    ],
  },
  {
    slug: 'product-photos-for-3d', date: '2026-09-03', minutes: 6,
    tag: { ar: 'دليل عملي', en: 'How-to' },
    title: { ar: 'تصوير المنتج لتوليد نموذج ثلاثي الأبعاد: دليل من صفحة واحدة', en: 'Photographing a product for 3D generation: a one-page guide' },
    excerpt: { ar: 'ثلاث زوايا، إضاءة متساوية، وخلفية لا تنافس المنتج.', en: 'Three angles, even light, and a background that does not compete with the product.' },
    sections: [
      { heading: { ar: 'الزوايا', en: 'The angles' }, paragraphs: [
        { ar: 'صوّر المنتج من الأمام والجانب والخلف، بالمسافة نفسها والارتفاع نفسه. للساعة: صورة للمينا مباشرة، وصورة جانبية يظهر فيها سُمك العلبة والتاج، وصورة للظهر. إن كان في المنتج تفصيل مهم (نقش، قفل) فأضف صورة قريبة له.', en: 'Shoot the product from the front, the side and the back, at the same distance and height. For a watch: one straight at the dial, one from the side showing case thickness and the crown, one of the back. If there is an important detail (an engraving, a clasp), add a close-up.' },
      ] },
      { heading: { ar: 'الإضاءة والخلفية', en: 'Light and background' }, paragraphs: [
        { ar: 'إضاءة نهار غير مباشرة أو صندوق إضاءة يعطيان أفضل النتائج. تجنّب الانعكاسات القوية على الزجاج والمعدن اللامع — حرّك مصدر الضوء بدل أن تحرّك المنتج. خلفية بيضاء أو رمادية فاتحة ثابتة في كل الصور.', en: 'Indirect daylight or a light box gives the best results. Avoid strong reflections on glass and polished metal — move the light rather than the product. A plain white or light-grey background, the same in every shot.' },
        { ar: 'صورة واضحة بجوال حديث تكفي. الوضوح أهم من الدقة العالية: صورة مهتزة بـ48 ميغابكسل أسوأ من صورة ثابتة بـ12.', en: 'A sharp photo from a recent phone is enough. Sharpness matters more than resolution: a shaky 48-megapixel photo is worse than a steady 12.' },
      ] },
      { heading: { ar: 'بعد الرفع', en: 'After upload' }, paragraphs: [
        { ar: 'نفحص الصور قبل التوليد ونخبرك إن كانت إحداها مظلمة أو مهتزة أو فيها خلفية مزدحمة، حتى لا تُستهلك أرصدتك على نتيجة ضعيفة. وإذا فشل التوليد يعود الرصيد تلقائيًا.', en: 'We check the photos before generating and tell you if one is dark, blurred or has a busy background, so your credits are not spent on a weak result. If a generation fails, its credits come back automatically.' },
      ] },
    ],
  },
  {
    slug: 'arabic-first', date: '2026-08-27', minutes: 4,
    tag: { ar: 'تصميم', en: 'Design' },
    title: { ar: '«عربية أولًا» ليست ترجمة', en: '“Arabic first” is not a translation' },
    excerpt: { ar: 'ما الذي يتغير حين تُصمم الواجهة من اليمين إلى اليسار منذ البداية.', en: 'What changes when an interface is designed right-to-left from the start.' },
    sections: [
      { paragraphs: [
        { ar: 'كثير من الأدوات تُصمم بالإنجليزية ثم تُترجم. تظهر النتيجة في التفاصيل: أيقونة سهم تشير للاتجاه الخطأ، رقم ينقلب مكانه في الجملة، أو «29.3 مم» تظهر «مم 29.3». العميل قد لا يعرف اسم المشكلة، لكنه يشعر أن الواجهة ليست له.', en: 'Many tools are designed in English and translated. It shows in the details: an arrow icon pointing the wrong way, a number jumping position in a sentence, or “29.3 mm” rendering as “mm 29.3”. The shopper may not know the name for it, but they can tell the interface was not made for them.' },
        { ar: 'في تجربة، العربية هي اللغة الافتراضية، وكل شاشة تُراجَع بالاتجاهين قبل أن تُنشر. حتى النصوص المرسومة على الصورة — كقياسات المقارنة — تُكتب باتجاه اللغة الصحيح.', en: 'In Tajribah, Arabic is the default language, and every screen is checked in both directions before it ships. Even text drawn onto the image — like the comparison measurements — is written in the right direction for its language.' },
      ] },
    ],
  },
  {
    slug: 'measuring-impact', date: '2026-08-20', minutes: 5,
    tag: { ar: 'التحليلات', en: 'Analytics' },
    title: { ar: 'كيف تقيس أثر التجربة الافتراضية على متجرك بإنصاف', en: 'How to measure the effect of try-on on your store fairly' },
    excerpt: { ar: 'قارن من جرّب بمن لم يجرّب — على المنتجات نفسها وفي الفترة نفسها.', en: 'Compare shoppers who tried with those who did not — on the same products, in the same period.' },
    sections: [
      { paragraphs: [
        { ar: 'أسهل طريقة لخداع نفسك: مقارنة مبيعات هذا الشهر بالشهر الماضي بعد تركيب أي أداة جديدة. المواسم والعروض وحملات الإعلان تغيّر الأرقام أكثر من أي زر.', en: 'The easiest way to fool yourself: comparing this month’s sales with last month’s after installing any new tool. Seasons, promotions and ad campaigns move the numbers more than any button.' },
      ] },
      { heading: { ar: 'ما الذي نقيسه في لوحة التحكم', en: 'What the dashboard measures' }, paragraphs: [
        { ar: 'نعرض مشاهدات المنتج، وعدد من فتح التجربة، ومن أضاف إلى السلة بعدها، على المنتجات نفسها وفي الفترة نفسها. المقارنة العادلة هي بين من جرّب ومن لم يجرّب على المنتج ذاته — مع تذكّر أن من يجرّب قد يكون أكثر اهتمامًا من البداية.', en: 'We show product views, how many opened the try-on, and who added to cart after it — on the same products, in the same period. The fair comparison is between shoppers who tried and those who did not on the same product — remembering that people who try may have been more interested to begin with.' },
        { ar: 'والمقياس الذي يستحق المتابعة أكثر من غيره هو نسبة الإرجاع بسبب المقاس. إن انخفضت على المنتجات المفعّلة مقارنة بغير المفعّلة، فهذا أثر حقيقي.', en: 'The measure most worth following is the return rate for size reasons. If it falls on enabled products compared with the rest, that is a real effect.' },
      ] },
    ],
  },
];

export const blogPost = (slug: string) => BLOG_POSTS.find((p) => p.slug === slug) ?? null;
