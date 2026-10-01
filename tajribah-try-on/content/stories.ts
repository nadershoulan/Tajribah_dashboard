import type { Bi } from '@/lib/lang';

/**
 * Customer stories (Track M, M9) — **illustrative examples, not customers.** The owner asked for
 * realistic stories before real ones exist. Presenting invented stores, quotes or results as
 * genuine would mislead the merchants reading them (and fake testimonials are prohibited under
 * Saudi e-commerce rules), so every story carries the `ILLUSTRATIVE` label on the page, the
 * stores have generic descriptive names rather than brand-like ones, there are no personal names
 * or photos, and figures are framed as what the example store would track. Replace a story with a
 * real one — with the customer's written permission — when there is one.
 */
export type Story = {
  slug: string;
  store: Bi;
  kind: Bi;
  city: Bi;
  platform: 'Salla' | 'Zid' | 'Custom';
  challenge: Bi;
  approach: Bi[];
  outcome: Bi;
  tracked: Bi[];
};

export const ILLUSTRATIVE: Bi = {
  ar: 'مثال توضيحي — متجر افتراضي يوضّح طريقة الاستخدام، وليس عميلًا حقيقيًا ولا نتائج فعلية.',
  en: 'Illustrative example — a hypothetical store showing how Tajribah is used, not a real customer or real results.',
};

export const STORIES: Story[] = [
  {
    slug: 'watch-boutique-riyadh',
    store: { ar: 'متجر ساعات مستقل', en: 'An independent watch boutique' },
    kind: { ar: 'ساعات رجالية ونسائية', en: 'Men’s and women’s watches' },
    city: { ar: 'الرياض', en: 'Riyadh' },
    platform: 'Salla',
    challenge: {
      ar: 'أكثر أسئلة المحادثة تكرارًا: «هل الساعة كبيرة على معصم نحيف؟»، وأكثر أسباب الإرجاع: المقاس. الصور الاحترافية لم تكن تجيب عن السؤال.',
      en: 'The most repeated chat question: “Is this watch too big for a slim wrist?” The most common return reason: size. Professional photos were not answering the question.',
    },
    approach: [
      { ar: 'فعّل التجربة على أكثر 30 ساعة مشاهدة، وأدخل قطر العلبة وعرض السوار لكل منها.', en: 'Turned try-on on for the 30 most-viewed watches and entered the case diameter and strap width for each.' },
      { ar: 'غيّر نص الزر إلى «شوفها على يدك» ليطابق لهجة المتجر.', en: 'Changed the button text to match the store’s own tone of voice.' },
      { ar: 'صار يردّ على سؤال المقاس في المحادثة برابط صفحة الساعة نفسها، ليجرّبها العميل قبل أن يسأل مرة أخرى.', en: 'Started answering the size question in chat with the watch’s own page link, so the shopper could try it on before asking again.' },
    ],
    outcome: {
      ar: 'في هذا المثال، صار الرد على سؤال المقاس رابطًا واحدًا بدل وصف طويل، وبدأ المتجر يقارن نسبة الإرجاع بسبب المقاس بين الساعات المفعّلة وغير المفعّلة.',
      en: 'In this example, answering the size question became one link instead of a long description, and the store started comparing size-related returns between enabled and non-enabled watches.',
    },
    tracked: [
      { ar: 'نسبة الإرجاع بسبب المقاس، للمنتجات المفعّلة مقابل غيرها', en: 'Size-related return rate, enabled products versus the rest' },
      { ar: 'أسئلة المقاس في المحادثة أسبوعيًا', en: 'Size questions in chat per week' },
      { ar: 'الإضافة إلى السلة بعد التجربة', en: 'Add to cart after a try-on' },
    ],
  },
  {
    slug: 'jewellery-jeddah',
    store: { ar: 'متجر مجوهرات وإكسسوارات', en: 'A jewellery and accessories store' },
    kind: { ar: 'أساور وخواتم وساعات أزياء', en: 'Bracelets, rings and fashion watches' },
    city: { ar: 'جدة', en: 'Jeddah' },
    platform: 'Zid',
    challenge: {
      ar: 'قطع صغيرة تبدو في الصور المكبّرة أكبر بكثير من حقيقتها، فيتفاجأ العميل عند الاستلام.',
      en: 'Small pieces look far larger in close-up photos than in reality, so customers were surprised on delivery.',
    },
    approach: [
      { ar: 'فعّل وضع «قارن الحجم» على كل الأساور، لتظهر كل قطعة بجانب ريال سعودي وسماعات إيربودز.', en: 'Turned on “Compare size” for every bracelet, so each piece appears next to a riyal coin and AirPods.' },
      { ar: 'أعاد إدخال المقاسات من ورقة المواصفات بالمليمتر بعد أن كانت مكتوبة تقريبيًا في الوصف.', en: 'Re-entered sizes in millimetres from the spec sheets, where the descriptions had only rough figures.' },
    ],
    outcome: {
      ar: 'في هذا المثال، صار العميل يرى القطعة بحجمها الحقيقي قبل الطلب، واكتشف المتجر أثناء إدخال المقاسات أن بعض أوصافه القديمة كانت غير دقيقة فصححها.',
      en: 'In this example, shoppers saw each piece at its real size before ordering, and while entering sizes the store found some old descriptions were inaccurate and corrected them.',
    },
    tracked: [
      { ar: 'الشكاوى من «أصغر من المتوقع» بعد الاستلام', en: '“Smaller than expected” complaints after delivery' },
      { ar: 'عدد من فتح وضع قارن الحجم لكل منتج', en: 'How many opened Compare size per product' },
    ],
  },
  {
    slug: 'straps-dammam',
    store: { ar: 'متجر أحزمة وإكسسوارات ساعات', en: 'A watch straps and accessories store' },
    kind: { ar: 'أحزمة للساعات الذكية والتقليدية', en: 'Straps for smart and classic watches' },
    city: { ar: 'الدمام', en: 'Dammam' },
    platform: 'Custom',
    challenge: {
      ar: 'متجر على منصة مخصصة، بلا تطبيق جاهز من متجر تطبيقات.',
      en: 'A store on a custom platform, with no ready app from an app store.',
    },
    approach: [
      { ar: 'أضاف مطوّر المتجر سطري التضمين إلى قالب صفحة المنتج، واستخدم زر «تحقق» في لوحة التحكم ليتأكد أن الزر يعمل.', en: 'The store’s developer added the two embed lines to the product-page template and used the dashboard’s “Check” button to confirm it worked.' },
      { ar: 'بدأ بوضع «على النموذج» للأحزمة مع إدخال عرض كل حزام بالمليمتر.', en: 'Started with “On model” for straps, entering each strap’s width in millimetres.' },
    ],
    outcome: {
      ar: 'في هذا المثال، استغرق التركيب أقل من ساعة عمل للمطوّر، ولم يتغير زمن تحميل صفحة المنتج لأن الاستوديو لا يُحمَّل إلا عند الضغط.',
      en: 'In this example, installation took the developer under an hour, and product-page load time did not change because the studio only loads on press.',
    },
    tracked: [
      { ar: 'زمن تحميل صفحة المنتج قبل التركيب وبعده', en: 'Product-page load time before and after installing' },
      { ar: 'نسبة من ضغط الزر من مشاهدي المنتج', en: 'Share of product viewers who pressed the button' },
    ],
  },
];
