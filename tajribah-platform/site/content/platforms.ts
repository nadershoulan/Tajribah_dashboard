import type { Bi } from '@site/lib/lang';

/**
 * Landing pages for merchants on Salla and Zid (Track M, M4).
 *
 * The platforms are named for what they are — Tajribah is an independent app that works with
 * them; no logo, endorsement or partnership is implied, and the page says so. Their own figures
 * (store counts, sales) are theirs to publish and are not repeated here. Availability follows the
 * integrations page: stores are onboarded directly until each app store listing opens.
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
    title: { ar: 'لا تغيير في قالبك', en: 'No change to your theme' },
    body: { ar: 'يظهر زر «جرّبها» في صفحة المنتج دون أن تعدّل قالب متجرك أو تستعين بمطوّر.', en: 'The “Try it on” button appears on the product page without editing your theme or hiring a developer.' },
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
        ar: 'اجعل عميلك يرى الساعة على معصمه ويقارن حجمها الحقيقي قبل أن يضغط «أضف إلى السلة» — داخل متجرك على سلة، وبالعربية أولًا.',
        en: 'Let shoppers see the watch on their wrist and compare its true size before they press “Add to cart” — inside your Salla store, Arabic first.',
      },
    },
    steps: [
      { title: { ar: 'ثبّت تطبيق تجربة', en: 'Install the Tajribah app' }, body: { ar: 'من متجر تطبيقات سلة، ووافق على الصلاحيات المطلوبة بضغطة واحدة: قراءة المنتجات وإضافة الزر إلى صفحة المنتج.', en: 'From the Salla App Store, approve the permissions in one step: reading products and adding the button to the product page.' } },
      { title: { ar: 'تُستورد منتجاتك', en: 'Your products import' }, body: { ar: 'نسحب منتجاتك وخياراتها وأسعارها، وتبقى محدّثة كلما غيّرتها في سلة.', en: 'We bring in your products, variants and prices, and keep them current whenever you change them in Salla.' } },
      { title: { ar: 'اختر المنتجات وأضف المقاسات', en: 'Pick products and add sizes' }, body: { ar: 'فعّل التجربة على المنتجات التي تريدها، وأدخل مقاسها بالمليمتر — هذا ما يجعل الحجم حقيقيًا.', en: 'Turn try-on on for the products you choose and enter their size in millimetres — that is what makes the size real.' } },
      { title: { ar: 'يظهر الزر في متجرك', en: 'The button appears in your store' }, body: { ar: 'زر «جرّبها» بلون متجرك ونصّه، في صفحة كل منتج فعّلته.', en: 'A “Try it on” button in your store’s colour and wording, on every product you turned on.' } },
    ],
    syncs: [
      { ar: 'المنتجات والصور والأوصاف من سلة', en: 'Products, images and descriptions from Salla' },
      { ar: 'الخيارات: المقاسات والألوان والخامات', en: 'Variants: sizes, colours and materials' },
      { ar: 'الأسعار، محدّثة تلقائيًا', en: 'Prices, kept up to date' },
    ],
    fit: SHARED_FIT,
    faq: [
      { q: { ar: 'هل أحتاج مطوّرًا لتركيبها على سلة؟', en: 'Do I need a developer to set it up on Salla?' }, a: { ar: 'لا. التطبيق يضيف الزر بنفسه بعد موافقتك. تحتاج فقط إلى إدخال مقاسات المنتجات بالمليمتر.', en: 'No. The app adds the button itself once you approve it. You only enter product sizes in millimetres.' } },
      { q: { ar: 'متى يُتاح التطبيق في متجر تطبيقات سلة؟', en: 'When will the app be in the Salla App Store?' }, a: { ar: 'نعمل حاليًا مع المتاجر الأولى بالتنسيق المباشر قبل فتح الإدراج العام. تواصل معنا ونضيف متجرك إلى الدفعة القادمة.', en: 'We are onboarding our first stores directly before the public listing opens. Contact us and we will add your store to the next group.' } },
      { q: { ar: 'هل تتغيّر طريقة الدفع أو الطلب عندي؟', en: 'Does anything change about orders or payment?' }, a: { ar: 'لا. العميل يضيف المنتج إلى سلة متجرك، ويكمل الطلب كما يفعل دائمًا.', en: 'No. The shopper adds the product to your store’s cart and checks out as always.' } },
      { q: { ar: 'ماذا لو ألغيت التطبيق؟', en: 'What if I uninstall the app?' }, a: { ar: 'يختفي الزر من متجرك فورًا، ونتوقف عن مزامنة منتجاتك. بياناتك في تجربة تبقى لك حتى تطلب حذفها.', en: 'The button disappears from your store immediately and we stop syncing your products. Your data in Tajribah stays yours until you ask for it to be deleted.' } },
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
      { title: { ar: 'فعّل تطبيق تجربة', en: 'Enable the Tajribah app' }, body: { ar: 'من سوق تطبيقات زد، ووافق على الصلاحيات: قراءة المنتجات وإضافة الزر إلى صفحة المنتج.', en: 'From the Zid app market, approve the permissions: reading products and adding the button to the product page.' } },
      { title: { ar: 'مزامنة الكتالوج', en: 'Catalogue sync' }, body: { ar: 'تنتقل منتجاتك وخياراتها وأسعارها من زد تلقائيًا، وأي تعديل لاحق يصلنا دون أن تكرره.', en: 'Your products, variants and prices come across from Zid automatically, and later edits reach us without you repeating them.' } },
      { title: { ar: 'أدخل المقاس الحقيقي', en: 'Enter the real size' }, body: { ar: 'لكل منتج مفعّل: عرضه وارتفاعه بالمليمتر. من دونها لا نعرض مقارنة الحجم، حتى لا نعطي عميلك رقمًا غير دقيق.', en: 'For each enabled product: its width and height in millimetres. Without them we do not show size comparison, so your shopper never gets a wrong number.' } },
      { title: { ar: 'جرّب قبل النشر', en: 'Preview before it goes live' }, body: { ar: 'شاهد الزر بلون متجرك ونصّه في لوحة التحكم، ثم انشره حين تكون راضيًا.', en: 'See the button in your store’s colour and wording in the dashboard, then publish when you are happy.' } },
    ],
    syncs: [
      { ar: 'المنتجات والصور والأوصاف من زد', en: 'Products, images and descriptions from Zid' },
      { ar: 'الخيارات والمقاسات المتاحة', en: 'Variants and available sizes' },
      { ar: 'الأسعار', en: 'Prices' },
    ],
    fit: SHARED_FIT,
    faq: [
      { q: { ar: 'هل يعمل مع قالبي في زد؟', en: 'Does it work with my Zid theme?' }, a: { ar: 'نعم. الزر يُضاف إلى صفحة المنتج دون تعديل القالب، ويمكنك تغيير لونه ونصّه ليطابق هوية متجرك.', en: 'Yes. The button is added to the product page without editing the theme, and you can change its colour and wording to match your store.' } },
      { q: { ar: 'متى يُتاح التطبيق في سوق تطبيقات زد؟', en: 'When will the app be in the Zid app market?' }, a: { ar: 'نعمل حاليًا مع المتاجر الأولى بالتنسيق المباشر. تواصل معنا لنرتب إضافة متجرك.', en: 'We are onboarding our first stores directly. Contact us and we will arrange adding your store.' } },
      { q: { ar: 'هل تُرفع صور عملائي إلى خوادمكم؟', en: 'Are my shoppers’ photos uploaded to your servers?' }, a: { ar: 'تحليل صورة المعصم يتم على جهاز العميل. لا نستخدم التعرّف على الوجوه ولا نحتفظ ببصمات حيوية.', en: 'Wrist-photo analysis runs on the shopper’s device. We use no facial recognition and keep no biometric templates.' } },
      { q: { ar: 'هل أستطيع تفعيلها على منتجات محددة فقط؟', en: 'Can I turn it on for some products only?' }, a: { ar: 'نعم، تختار المنتجات التي يظهر عليها الزر، ويمكنك إيقافه على أي منتج متى شئت.', en: 'Yes. You choose which products show the button and can turn it off on any product whenever you like.' } },
    ],
  },
};

export const TRADEMARK_NOTE: Bi = {
  ar: 'سلة وزد علامتان تجاريتان لمالكيهما. تجربة تطبيق مستقل يعمل مع المنصتين، ولا يعني ذكرهما شراكة أو تأييدًا.',
  en: 'Salla and Zid are trademarks of their owners. Tajribah is an independent app that works with both; naming them implies no partnership or endorsement.',
};
