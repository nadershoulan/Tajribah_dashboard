import type { Bi } from '@site/lib/lang';

/**
 * Landing pages for merchants on Salla and Zid (Track M, M4).
 *
 * The platforms are named for what they are — Tajribah is an independent app that works with
 * them; no logo, endorsement or partnership is implied, and the page says so. Their own figures
 * (store counts, sales) are theirs to publish and are not repeated here. T86: today a product feed link
 * or a file brings a store's products in; linking each platform directly (an app in its store) is
 * version 2 (T81), and the pages say so.
 */
export type PlatformPage = {
  slug: 'salla' | 'zid';
  name: Bi;
  latin: string;
  appStore: Bi;
  hero: { title: Bi; lead: Bi };
  steps: { title: Bi; body: Bi }[];
  syncs: Bi[];
  fit: { title: Bi; body: Bi }[];
  faq: { q: Bi; a: Bi }[];
};

const SHARED_FIT: PlatformPage['fit'] = [
  {
    title: { ar: 'صفحة لكل منتج، دون تركيب', en: 'A page for each product, nothing to install' },
    body: { ar: 'كل منتج تنشره له صفحة على تجربة ورمز QR، تشاركهما من متجرك أو حساباتك دون أن تعدّل قالبك.', en: 'Each product you publish has a page on Tajribah and a QR code, to share from your store or your accounts without editing your theme.' },
  },
  {
    title: { ar: 'لا تُبطئ صفحة المنتج', en: 'Your product page stays fast' },
    body: { ar: 'الاستوديو ونموذج الرؤية يُحمَّلان فقط حين يضغط العميل على الزر، فلا يتأثر زمن تحميل الصفحة.', en: 'The studio and the vision model load only when a shopper presses the button, so page load time is untouched.' },
  },
  {
    title: { ar: 'السلة كما هي', en: 'The cart stays yours' },
    body: { ar: 'الإضافة إلى السلة تتم عبر متجرك نفسه، فالطلب والدفع والشحن كلها في منصتك كالمعتاد.', en: 'Add to cart goes through your own store, so the order, payment and shipping all stay in your platform as usual.' },
  },
];

export const PLATFORM_PAGES: Record<'salla' | 'zid', PlatformPage> = {
  salla: {
    slug: 'salla',
    name: { ar: 'سلة', en: 'Salla' },
    latin: 'Salla',
    appStore: { ar: 'متجر تطبيقات سلة', en: 'the Salla App Store' },
    hero: {
      title: { ar: 'التجربة الافتراضية لمتاجر سلة', en: 'Virtual try-on for Salla stores' },
      lead: {
        ar: 'اجعل عميلك يرى الساعة على معصمه ويقارن حجمها الحقيقي قبل أن يضغط «أضف إلى السلة» — منتجاتك من متجرك على سلة، وبالعربية أولًا.',
        en: 'Let shoppers see the watch on their wrist and compare its true size before they press “Add to cart” — your products from your Salla store, Arabic first.',
      },
    },
    steps: [
      { title: { ar: 'انسخ رابط ملف منتجاتك', en: 'Copy your product feed link' }, body: { ar: 'ثبّت من متجر تطبيقات سلة تطبيقًا يولّد رابط Google Merchant، وانسخ «رابط الخدمة». أو صدّر منتجاتك ملفًا.', en: 'Install an app from the Salla App Store that makes a Google Merchant link, and copy its “service link”. Or export your products as a file.' } },
      { title: { ar: 'الصقه في تجربة', en: 'Paste it into Tajribah' }, body: { ar: 'تصل منتجاتك بصورها وأسعارها وتصنيفاتها، ونقرأ الرابط من جديد كل 24 ساعة.', en: 'Your products arrive with their pictures, prices and categories, and we read the link again every 24 hours.' } },
      { title: { ar: 'جهّز المنتجات وجرّبها', en: 'Prepare the products and try them' }, body: { ar: 'أضف المقاس بالمليمتر وصورة التجربة، وجرّب كل منتج في لوحة التحكم كما يراه عميلك قبل أن تنشره.', en: 'Add the size in millimetres and the try-on picture, and try each product in the dashboard as your shopper will, before you publish it.' } },
      { title: { ar: 'انشر وشارك', en: 'Publish and share' }, body: { ar: 'لكل منتج منشور صفحة ورمز QR على تجربة، تضع رابطها في متجرك على سلة أو في حساباتك. وفي صفحة المنتج نفسها زر «جرّبها»: وسم واحد في Google Tag Manager تربطه من تطبيق سلة، دون تعديل القالب.', en: 'Each published product gets a page and a QR code on Tajribah, to link from your Salla store or your social accounts. And on the product page itself a “Try it” button: one tag in Google Tag Manager, linked from Salla’s app, with no theme edit.' } },
    ],
    syncs: [
      { ar: 'الاسم والصور والوصف', en: 'Name, pictures and description' },
      { ar: 'السعر والتصنيف', en: 'Price and category' },
      { ar: 'المقاسات، إن كانت في الملف', en: 'Dimensions, when the feed has them' },
    ],
    fit: SHARED_FIT,
    faq: [
      { q: { ar: 'هل يوجد تطبيق تجربة في متجر تطبيقات سلة؟', en: 'Is there a Tajribah app in the Salla App Store?' }, a: { ar: 'ليس بعد: الربط المباشر بسلة ضمن الإصدار الثاني. اليوم تضيف منتجاتك من رابط ملف المنتجات أو من ملف، ولا تحتاج تطبيقًا.', en: 'Not yet: linking directly with Salla is in version 2. Today you add your products from a product feed link or a file, with no app needed.' } },
      { q: { ar: 'هل أحتاج مطوّرًا؟', en: 'Do I need a developer?' }, a: { ar: 'لا. تضيف منتجاتك من رابط أو ملف، ولكل منتج صفحة ورمز QR على تجربة. وزر «جرّبها» داخل صفحة منتجك وسم واحد تضيفه في Google Tag Manager، الذي تربطه من تطبيق سلة نفسه — والخطوات في لوحة التحكم.', en: 'No. You add your products from a link or a file, and each product gets a page and a QR code on Tajribah. The “Try it” button inside your own product page is one tag you add in Google Tag Manager, which you link from Salla’s own app — the steps are in the dashboard.' } },
      { q: { ar: 'هل يظهر الزر على كل منتجاتي؟', en: 'Does the button show on all my products?' }, a: { ar: 'على كل منتج تنشره من تجربة. الوسم واحد لكل متجرك: ما تنشره لاحقًا يظهر زره تلقائيًا، وما لم تنشره لا يتغيّر فيه شيء.', en: 'On every product you publish from Tajribah. The tag is one for your whole store: what you publish later gets its button by itself, and nothing changes on what you have not published.' } },
      { q: { ar: 'هل تتغيّر طريقة الدفع أو الطلب عندي؟', en: 'Does anything change about orders or payment?' }, a: { ar: 'لا. العميل يضيف المنتج إلى سلة متجرك، ويكمل الطلب كما يفعل دائمًا.', en: 'No. The shopper adds the product to your store’s cart and checks out as always.' } },
      { q: { ar: 'هل تبقى منتجاتي محدّثة؟', en: 'Do my products stay up to date?' }, a: { ar: 'نقرأ رابط ملف منتجاتك كل 24 ساعة، فما تغيّره في سلة يصلنا مع القراءة التالية. ويمكنك طلب قراءته فورًا من لوحة التحكم.', en: 'We read your product feed link every 24 hours, so what you change in Salla reaches us with the next reading. You can also ask for a reading now in the dashboard.' } },
    ],
  },
  zid: {
    slug: 'zid',
    name: { ar: 'زد', en: 'Zid' },
    latin: 'Zid',
    appStore: { ar: 'سوق تطبيقات زد', en: 'the Zid app market' },
    hero: {
      title: { ar: 'التجربة الافتراضية لمتاجر زد', en: 'Virtual try-on for Zid stores' },
      lead: {
        ar: 'أضف إلى متجرك على زد تجربة الساعات والإكسسوارات على المعصم ومقارنة حجمها بأشياء يعرفها الجميع، دون تطبيق يثبّته العميل.',
        en: 'Add wrist try-on and true-size comparison for watches and accessories to your Zid store — with nothing for the shopper to install.',
      },
    },
    steps: [
      { title: { ar: 'انسخ رابط ملف منتجاتك', en: 'Copy your product feed link' }, body: { ar: 'رابط ملف منتجات متجرك كما تعطيه لـ Google Merchant Center، أو صدّر منتجاتك ملفًا.', en: 'Your store’s product feed link as you give it to Google Merchant Center, or export your products as a file.' } },
      { title: { ar: 'الصقه في تجربة', en: 'Paste it into Tajribah' }, body: { ar: 'تصل منتجاتك بصورها وأسعارها وتصنيفاتها، ونقرأ الرابط من جديد كل 24 ساعة.', en: 'Your products arrive with their pictures, prices and categories, and we read the link again every 24 hours.' } },
      { title: { ar: 'جهّز المنتجات وجرّبها', en: 'Prepare the products and try them' }, body: { ar: 'أضف المقاس بالمليمتر وصورة التجربة، وجرّب كل منتج في لوحة التحكم كما يراه عميلك قبل أن تنشره.', en: 'Add the size in millimetres and the try-on picture, and try each product in the dashboard as your shopper will, before you publish it.' } },
      { title: { ar: 'انشر وشارك', en: 'Publish and share' }, body: { ar: 'لكل منتج منشور صفحة ورمز QR على تجربة، تضع رابطها في متجرك على زد أو في حساباتك. وإن كان قالبك يقبل كودًا، فزر «جرّبها» في صفحة المنتج نفسها.', en: 'Each published product gets a page and a QR code on Tajribah, to link from your Zid store or your social accounts. And if your theme takes code, a “Try it” button on the product page itself.' } },
    ],
    syncs: [
      { ar: 'الاسم والصور والوصف', en: 'Name, pictures and description' },
      { ar: 'السعر والتصنيف', en: 'Price and category' },
      { ar: 'المقاسات، إن كانت في الملف', en: 'Dimensions, when the feed has them' },
    ],
    fit: SHARED_FIT,
    faq: [
      { q: { ar: 'هل يوجد تطبيق تجربة في سوق تطبيقات زد؟', en: 'Is there a Tajribah app in the Zid app market?' }, a: { ar: 'ليس بعد: الربط المباشر بزد ضمن الإصدار الثاني. اليوم تضيف منتجاتك من رابط ملف المنتجات أو من ملف.', en: 'Not yet: linking directly with Zid is in version 2. Today you add your products from a product feed link or a file.' } },
      { q: { ar: 'متجري لا يعطي رابط ملف منتجات، ماذا أفعل؟', en: 'My store gives no product feed link — what then?' }, a: { ar: 'صدّر منتجاتك ملفًا وارفعه، أو أضفها يدويًا من لوحة التحكم.', en: 'Export your products as a file and upload it, or add them by hand in the dashboard.' } },
      { q: { ar: 'هل تُرفع صور عملائي إلى خوادمكم؟', en: 'Are my shoppers’ photos uploaded to your servers?' }, a: { ar: 'تحليل صورة العميل يتم على جهازه. لا نستخدم التعرّف على الوجوه ولا نحتفظ ببصمات حيوية.', en: 'The shopper’s photo is analysed on their device. We use no facial recognition and keep no biometric templates.' } },
      { q: { ar: 'هل أستطيع تفعيلها على منتجات محددة فقط؟', en: 'Can I turn it on for some products only?' }, a: { ar: 'نعم، تنشر المنتجات التي تريدها فقط، ويمكنك إيقاف أي منتج متى شئت.', en: 'Yes. You publish only the products you choose, and can take any product down whenever you like.' } },
    ],
  },
};

export const TRADEMARK_NOTE: Bi = {
  ar: 'سلة وزد علامتان تجاريتان لمالكيهما. تجربة خدمة مستقلة، ولا يعني ذكرهما شراكة أو تأييدًا.',
  en: 'Salla and Zid are trademarks of their owners. Tajribah is an independent service; naming them implies no partnership or endorsement.',
};
