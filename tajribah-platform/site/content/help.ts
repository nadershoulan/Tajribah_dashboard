import type { Bi } from '@site/lib/lang';

/**
 * Help centre (Track M, M8). Every article describes the merchant dashboard as it is built
 * (tajribah-platform): the onboarding steps, the connection, 3D models and versions, the AR
 * button, the embed line, team roles, two-step sign-in, plans, the 14-day trial and what happens
 * after it, invoices with 15% VAT, AI credits, privacy requests (30 days), WooCommerce and single
 * sign-on, products' own pages (P1.19), the iPhone file and the model's picture, professional models (P3.10). Nothing here
 * promises a feature the dashboard does not have.
 */
export type HelpArticle = {
  slug: string;
  category: HelpCategoryKey;
  title: Bi;
  summary: Bi;
  steps?: Bi[];
  body: Bi[];
  updated: string; // YYYY-MM-DD
};

export type HelpCategoryKey = 'start' | 'connect' | 'models' | 'button' | 'billing' | 'account';

export const HELP_CATEGORIES: { key: HelpCategoryKey; title: Bi; blurb: Bi }[] = [
  { key: 'start', title: { ar: 'البداية', en: 'Getting started' }, blurb: { ar: 'إنشاء الحساب وخطوات الإعداد الأولى.', en: 'Creating your account and the first setup steps.' } },
  { key: 'connect', title: { ar: 'ربط المتجر', en: 'Connecting your store' }, blurb: { ar: 'سلة وزد وWooCommerce وسطر التضمين لأي متجر آخر.', en: 'Salla, Zid, WooCommerce, and the embed line for any other store.' } },
  { key: 'models', title: { ar: 'المنتجات والنماذج', en: 'Products and 3D models' }, blurb: { ar: 'المقاسات والنماذج ثلاثية الأبعاد ونسخها.', en: 'Sizes, 3D models and their versions.' } },
  { key: 'button', title: { ar: 'الزر والتجربة', en: 'The button and try-on' }, blurb: { ar: 'شكل الزر وصفحة كل منتج وما يراه العميل.', en: 'Button style, each product’s own page and what shoppers see.' } },
  { key: 'billing', title: { ar: 'الباقات والفواتير', en: 'Plans and invoices' }, blurb: { ar: 'التجربة المجانية والباقات والفواتير والأرصدة.', en: 'The free trial, plans, invoices and credits.' } },
  { key: 'account', title: { ar: 'الحساب والفريق والخصوصية', en: 'Account, team and privacy' }, blurb: { ar: 'الأعضاء والصلاحيات والتحقق بخطوتين وبياناتك.', en: 'Members, roles, two-step sign-in and your data.' } },
];

export const HELP_ARTICLES: HelpArticle[] = [
  {
    slug: 'create-account', category: 'start', updated: '2026-09-20',
    title: { ar: 'إنشاء حساب وبدء التجربة المجانية', en: 'Create an account and start the free trial' },
    summary: { ar: 'أربع دقائق من التسجيل إلى لوحة التحكم، وتجربة مجانية لمدة 14 يومًا.', en: 'Four minutes from sign-up to the dashboard, with a 14-day free trial.' },
    steps: [
      { ar: 'سجّل ببريدك الإلكتروني وكلمة مرور لا تقل عن 10 أحرف.', en: 'Sign up with your email and a password of at least 10 characters.' },
      { ar: 'افتح رسالة التأكيد وأكّد بريدك.', en: 'Open the confirmation email and verify your address.' },
      { ar: 'أدخل اسم متجرك ومدينتك، واختر عنوان متجرك في تجربة.', en: 'Enter your store name and city, and choose your store’s address in Tajribah.' },
      { ar: 'أكمل خطوات الإعداد في الصفحة الرئيسية بالترتيب الذي يناسبك.', en: 'Work through the setup steps on the home page in whatever order suits you.' },
    ],
    body: [
      { ar: 'يبدأ كل متجر بتجربة مجانية لمدة 14 يومًا بمزايا باقة «النمو» دون بطاقة دفع. تظهر المدة المتبقية أسفل القائمة الجانبية، وتختار باقتك قبل نهايتها.', en: 'Every store starts with a 14-day free trial with the Growth plan’s features and no card required. The days left show at the bottom of the side menu; you choose your plan before they run out.' },
      { ar: 'يمكنك تخطي أي خطوة إعداد والعودة إليها لاحقًا من «دليل الإعداد».', en: 'You can skip any setup step and come back to it later from the “Setup guide”.' },
    ],
  },
  {
    slug: 'setup-checklist', category: 'start', updated: '2026-09-20',
    title: { ar: 'خطوات الإعداد الست', en: 'The six setup steps' },
    summary: { ar: 'ما الذي تطلبه كل خطوة ولماذا.', en: 'What each step asks for, and why.' },
    body: [
      { ar: 'إنشاء الحساب، ثم بيانات المتجر (الاسم والسجل التجاري والرقم الضريبي إن وُجد — تظهر في فواتيرك)، ثم إضافة منتجاتك من رابط أو ملف، ثم مراجعة المقاسات، ثم أول نموذج ثلاثي الأبعاد، ثم تركيب الزر في متجرك.', en: 'Create the account; store details (name, CR and VAT number if you have one — they appear on your invoices); add your products from a link or a file; check your dimensions; your first 3D model; install the button in your store.' },
      { ar: 'خطوة المقاسات هي الأهم: المقارنة بالحجم الحقيقي لا تظهر لمنتج بلا عرض وارتفاع بالمليمتر، حتى لا يرى عميلك رقمًا غير دقيق.', en: 'The dimensions step matters most: true-size comparison does not show for a product without a width and height in millimetres, so your shopper never sees a wrong number.' },
    ],
  },
  {
    slug: 'import-products', category: 'connect', updated: '2026-10-05',
    title: { ar: 'أضف منتجاتك من رابط أو ملف', en: 'Add your products from a link or a file' },
    summary: { ar: 'رابط ملف المنتجات كما في Google Merchant Center، أو ملف — من أي منصة.', en: 'A product feed link as for Google Merchant Center, or a file — from any platform.' },
    steps: [
      { ar: 'من لوحة التحكم افتح «ربط المتجر».', en: 'In the dashboard open “Store connections”.' },
      { ar: 'الصق رابط ملف المنتجات واضغط «استورد المنتجات» — أو اسحب ملفًا إلى المربع.', en: 'Paste the product feed link and press “Import products” — or drag a file into the box.' },
      { ar: 'تظهر منتجاتك في «المنتجات» بصورها وأسعارها وتصنيفاتها، ثم أضف المقاسات وجرّب كل منتج من معاينته.', en: 'Your products appear under “Products” with their pictures, prices and categories; then add the sizes and try each product from its preview.' },
    ],
    body: [
      { ar: 'في سلة: ثبّت من متجر تطبيقات سلة تطبيقًا يولّد رابط Google Merchant، ثم انسخ «رابط الخدمة» والصقه في تجربة. يصلح أي رابط بصيغة Google Merchant (XML) أو جدول CSV/TSV.', en: 'On Salla: install an app from the Salla App Store that makes a Google Merchant link, then copy its “service link” and paste it into Tajribah. Any link in Google Merchant format (XML) or a CSV/TSV table works.' },
      { ar: 'نقرأ الرابط فور لصقه، ثم تلقائيًا كل 24 ساعة: ما تغيّره في متجرك يصل مع القراءة التالية.', en: 'We read the link as soon as you paste it, then automatically every 24 hours: what you change in your store arrives with the next reading.' },
      { ar: 'الملف: CSV أو TSV أو Excel أو XML بصيغة Google Merchant، حتى 30 ميغابايت، وأسماء الأعمدة في الصف الأول (مثل id و title و price و image_link). إن غيّرت الملف فارفعه مرة أخرى.', en: 'A file: CSV, TSV, Excel, or XML in Google Merchant format, up to 30 MB, with the column names in the first row (such as id, title, price and image_link). If you change the file, upload it again.' },
      { ar: 'الربط المباشر بسلة وزد وShopify وWooCommerce — بتطبيق من متجر تطبيقات منصتك ومزامنة فورية لكل تعديل — يأتي في الإصدار الثاني.', en: 'Linking directly with Salla, Zid, Shopify and WooCommerce — through an app from your platform’s app store, with every change synced at once — comes in version 2.' },
    ],
  },
  {
    slug: 'embed-any-store', category: 'connect', updated: '2026-09-18',
    title: { ar: 'تركيب الزر في أي متجر بسطر تضمين', en: 'Install the button in any store with an embed line' },
    summary: { ar: 'لمتجر مخصص أو منصة غير مدرجة.', en: 'For a custom store or an unlisted platform.' },
    steps: [
      { ar: 'افتح «التركيب في متجرك» وانسخ السطرين.', en: 'Open “Install in your store” and copy the two lines.' },
      { ar: 'ألصقهما في قالب صفحة المنتج، وضع رمز المنتج (SKU) مكان المثال.', en: 'Paste them into your product-page template and put the product code (SKU) in place of the example.' },
      { ar: 'اضغط «تحقق» ليفتح النظام صفحة منتجك ويتأكد أن الزر يعمل.', en: 'Press “Check” and we open your product page to confirm the button works.' },
    ],
    body: [
      { ar: 'السكربت يُحمَّل مؤجّلًا (defer) ولا يوقف عرض صفحتك، والاستوديو نفسه لا يُحمَّل إلا عند الضغط على الزر.', en: 'The script loads with defer and never blocks your page; the studio itself loads only when the button is pressed.' },
    ],
  },
  {
    slug: 'dimensions', category: 'models', updated: '2026-09-22',
    title: { ar: 'إدخال المقاسات بالمليمتر', en: 'Entering sizes in millimetres' },
    summary: { ar: 'لماذا المليمتر، وأي بُعد نقيس.', en: 'Why millimetres, and which dimension to measure.' },
    body: [
      { ar: 'للساعة: قطر العلبة (دون التاج) وعرض السوار. للخاتم: القطر الداخلي. للنظارة: العرض الكلي للإطار. أدخل الأرقام كما في ورقة المواصفات من المصنّع.', en: 'For a watch: the case diameter (without the crown) and the strap width. For a ring: the inner diameter. For glasses: the frame’s total width. Enter the figures from the manufacturer’s spec sheet.' },
      { ar: 'نعرض المقاس للعميل بالمليمتر أو البوصة حسب اختياره، لكننا نحفظه بالمليمتر دائمًا حتى لا يتراكم خطأ التقريب.', en: 'Shoppers can see sizes in millimetres or inches, but we always store millimetres so rounding errors never pile up.' },
    ],
  },
  {
    slug: 'upload-model', category: 'models', updated: '2026-09-22',
    title: { ar: 'رفع نموذج ثلاثي الأبعاد', en: 'Upload a 3D model' },
    summary: { ar: 'ملف GLB أو USDZ، ونضغطه لك ليبقى خفيفًا.', en: 'A GLB or USDZ file, compressed for you to stay light.' },
    steps: [
      { ar: 'افتح المنتج ثم «النماذج ثلاثية الأبعاد»، واسحب الملف إلى الصفحة أو اختره.', en: 'Open the product, then “3D models”, and drop the file on the page or choose it.' },
      { ar: 'ننتظر فحص الملف وضغطه، وترى الحجم قبل الضغط وبعده.', en: 'We check and compress the file; you see its size before and after.' },
      { ar: 'اضغط «نشر» لتصبح هذه النسخة ما يراه العملاء.', en: 'Press “Publish” to make this version the one shoppers see.' },
    ],
    body: [
      { ar: 'نستهدف أقل من 2 ميغابايت لكل نموذج، لأن حجم الملف هو زمن التحميل على جوال عميلك. الملف المرفوض يظهر مع السبب بالعربية.', en: 'We aim for under 2 MB per model, because file size is load time on your shopper’s phone. A rejected file shows the reason.' },
      { ar: 'رفع نسخة جديدة لا ينشرها تلقائيًا: النسخة المنشورة تبقى حتى تختار غيرها، ويمكنك العودة إلى نسخة أقدم بضغطة.', en: 'Uploading a new version never publishes it on its own: the published version stays until you choose another, and you can go back to an older one in one click.' },
      // P1.13b — the iPhone file, made from every GLB.
      { ar: 'من ملف GLB نصنع لك أيضًا ملف الآيفون (USDZ) تلقائيًا، فيفتح المنتج في غرفة العميل على الآيفون مباشرة من زر متجرك، بمقاسه الحقيقي.', en: 'From a GLB we also make the iPhone file (USDZ) for you, so the product opens in the shopper’s room on an iPhone straight from your store’s button, at its real size.' },
      // P3.8 — the model's picture.
      { ar: 'من «تعديل» في قائمة النماذج: أدِر النموذج وقرّبه حتى يبدو كما تريد، ثم «استخدم هذا المنظر صورةً». تظهر الصورة في قائمة النماذج، وفي معاينة رابط صفحة المنتج حين تشاركه.', en: 'From “Edit” in the model list: turn and zoom the model until it looks right, then “Use this view as the picture”. The picture shows in the model list, and in the preview of the product page’s link when you share it.' },
    ],
  },
  {
    // P3.10 (T66) — the product page's panel, as built. Paying opens with the payment gateway.
    slug: 'professional-model', category: 'models', updated: '2026-10-02',
    title: { ar: 'اطلب نموذجًا احترافيًا من فريق تجربة', en: 'Ask Tajribah’s team for a professional model' },
    summary: { ar: 'حين لا تكفي الصور: نصنع نموذجًا دقيقًا لمنتجك، بسعر لكل منتج.', en: 'When photos are not enough: we build an accurate model of your product, priced per product.' },
    steps: [
      { ar: 'افتح صفحة المنتج، وفي «نموذج احترافي من فريق تجربة» اكتب ما يجب أن ننتبه له إن أردت، ثم «اطلب عرض سعر».', en: 'Open the product’s page; in “A professional model from Tajribah” note anything we should watch for if you like, then “Ask for a quote”.' },
      { ar: 'يطّلع فريقنا على المنتج وصوره ومقاساته، ثم يرسل لك السعر في الصفحة نفسها، وتصلك تنبيهة.', en: 'Our team looks at the product, its photos and its measurements, then sends you the price on the same page, and you are notified.' },
      { ar: 'ترى السعر وضريبة القيمة المضافة 15% والإجمالي.', en: 'You see the price, the 15% VAT and the total.' },
    ],
    body: [
      { ar: 'كلما أضفت صورًا أوضح للمنتج من زوايا مختلفة ومقاساته بالمليمتر، كان السعر أدق والنموذج أقرب.', en: 'The clearer the photos you add from different angles, and the measurements in millimetres, the more accurate the price and the closer the model.' },
      { ar: 'يمكنك إلغاء الطلب في أي وقت قبل بدء العمل. الدفع بالبطاقة يُفتح قريبًا؛ حتى ذلك الحين لا يُخصم منك شيء ولا يبدأ العمل.', en: 'You can cancel the request any time before work starts. Card payment opens soon; until then nothing is charged and no work starts.' },
      { ar: 'لكل منتج طلب مفتوح واحد في الوقت نفسه.', en: 'Each product has one open request at a time.' },
    ],
  },
  {
    slug: 'button-style', category: 'button', updated: '2026-09-19',
    title: { ar: 'تخصيص شكل الزر ونصّه', en: 'Customise the button’s look and wording' },
    summary: { ar: 'اللون والنص والأيقونة والشكل.', en: 'Colour, wording, icon and shape.' },
    body: [
      { ar: 'من «إعدادات الواقع المعزز» اختر لون الزر ونصّه بالعربية والإنجليزية، وشكله (ممتلئ أو إطار فقط)، وإظهار الأيقونة. تظهر المعاينة بجانب الإعدادات قبل الحفظ.', en: 'In “AR settings” choose the button’s colour, its wording in Arabic and English, its style (filled or outline) and whether it shows an icon. A preview appears beside the settings before you save.' },
      { ar: 'التغييرات تصل إلى متجرك خلال دقائق، دون إعادة تركيب.', en: 'Changes reach your store within minutes, with nothing to reinstall.' },
    ],
  },
  {
    // P1.19 — AR settings → "Product page", as built.
    slug: 'product-page', category: 'button', updated: '2026-10-01',
    title: { ar: 'صفحة خاصة لكل منتج', en: 'A page of its own for each product' },
    summary: { ar: 'رابط واحد تشاركه في منشور أو رسالة أو في حسابك.', en: 'One link to share in a post, a message or your profile.' },
    steps: [
      { ar: 'انشر المنتج من «إعدادات العرض» بزر «انشر في المتجر».', en: 'Publish the product from “AR settings” with “Publish to the store”.' },
      { ar: 'في لوحة «صفحة المنتج» أسفلها يظهر رابط الصفحة: انسخه أو افتحه.', en: 'In the “Product page” panel below, the page’s link appears: copy it or open it.' },
      { ar: 'أضف رابط شراء المنتج في متجرك إن أردت، واحفظ.', en: 'Add the link to buy the product in your shop if you like, and save.' },
    ],
    body: [
      { ar: 'تعرض الصفحة المنتج بأبعاده الثلاثية يدور ببطء، ومعه زر «شاهدها في مكانك» الذي يضعه في غرفة المتسوّق بمقاسه الحقيقي على الجوال. أما الساعة فتفتح في استوديو التجربة نفسه الذي يفتحه زرّ متجرك.', en: 'The page shows the product in 3D, turning slowly, with “View in your space”, which places it in the shopper’s room at its real size on a phone. A watch opens in the same try-on studio your store’s button opens.' },
      { ar: 'رابط الشراء يظهر زرًا «اشترها من …» باسم متجرك، ويجب أن يبدأ بـ https://. يمكنك إيقاف الصفحة في أي وقت؛ فيقول الرابط إنها غير متاحة خلال دقيقة تقريبًا، ويعود حين تفعّلها.', en: 'The buy link shows as a “Buy it at …” button with your store’s name, and must start with https://. You can switch the page off at any time; the link then says it is not available within about a minute, and comes back when you switch it on.' },
      { ar: 'الصفحة في كل الباقات، ولا تظهر في محركات البحث، حتى تبقى صفحة منتجك في متجرك هي التي تظهر. في باقة «المؤسسات» تظهر باسم متجرك دون «بتقنية تجربة»، وعلى عنوان متجرك الخاص إن فعّلته.', en: 'The page comes with every plan, and is kept out of search engines, so your own store’s product page is the one that shows up. On Enterprise it carries your store’s name without “Powered by Tajribah”, and lives on your store’s own address once you switch that on.' },
    ],
  },
  {
    // T34 — P1.20 waits on the short domain: a printed code must never stop working.
    slug: 'qr-codes', category: 'button', updated: '2026-10-01',
    title: { ar: 'رموز QR للمنتجات (قريبًا)', en: 'QR codes for products (coming soon)' },
    summary: { ar: 'للواجهات والكتالوجات المطبوعة — تصل مع عنوان تجربة القصير.', en: 'For shop windows and printed catalogues — arriving with Tajribah’s short address.' },
    body: [
      { ar: 'الرمز المطبوع يبقى على البطاقة أو الكتالوج سنوات، فيجب أن يحمل عنوانًا لن يتغيّر أبدًا. لذلك تصل رموز QR مع عنوان تجربة القصير النهائي، لا قبله.', en: 'A printed code stays on a card or catalogue for years, so it must carry an address that never changes. That is why QR codes arrive with Tajribah’s final short address, not before.' },
      { ar: 'حتى ذلك الحين، شارك رابط صفحة المنتج نفسها — من «إعدادات العرض» ← «صفحة المنتج».', en: 'Until then, share the product’s own page link — from “AR settings” → “Product page”.' },
    ],
  },
  {
    // P5.14 — the try-on settings (P5.10), the size check (P5.9) and the numbers (P5.13), as built.
    slug: 'watch-tryon-setup', category: 'button', updated: '2026-09-28',
    title: { ar: 'تجهيز ساعة للتجربة الافتراضية', en: 'Set up a watch for the try-on' },
    summary: { ar: 'صورتان بخلفية شفافة وعرض العلبة، لتظهر الساعة بمقاسها الحقيقي.', en: 'Two pictures on a transparent background and the case width, so the watch shows at its real size.' },
    steps: [
      { ar: 'اجعل نوع المنتج «ساعة» في صفحته، ثم افتح «التجربة الافتراضية» من لوحة التحكم.', en: 'Set the product’s type to Watch on its page, then open “Virtual try-on” in the dashboard.' },
      { ar: 'ارفع «الساعة كما تُلبس»: الساعة من الأمام بسوارها مفتوحًا كما على المعصم. وارفع «صورة المنتج»: الساعة وحدها من الأمام.', en: 'Upload “The watch as worn”: the watch from the front with its strap as on a wrist. Then upload “The product shot”: the watch alone, from the front.' },
      { ar: 'أدخل عرض العلبة بالمليمتر — العلبة وحدها دون التاج، كما تقيسها — ووصف اللون إن أردت، بالعربية والإنجليزية معًا.', en: 'Enter the case width in millimetres — the case alone, without the crown, as you measure it — and a finish line if you like, in Arabic and English together.' },
      { ar: 'فعّل زر «جرّبها» حين تكتمل الصورتان وعرض العلبة. يظهر الزر في صفحة المنتج في متجرك بعد نشر إعداداتك.', en: 'Switch on the “Try it on” button once both pictures and the case width are there. The button appears on the product’s page in your store once your settings are published.' },
    ],
    body: [
      { ar: 'الصورتان بصيغة PNG أو WebP وبخلفية شفافة فعلًا، لا بيضاء. نقرأ الشفافية من الملف نفسه ونرفض الصورة التي بلا شفافية مع السبب. أطول ضلع 200 بكسل على الأقل، والحجم حتى 10 ميغابايت.', en: 'Both pictures are PNG or WebP with a truly transparent background, not a white one. We read the transparency from the file itself and refuse a picture without it, saying why. The long side is at least 200 pixels, and the file up to 10 MB.' },
      { ar: 'قصّ الصورة على حافتي العلبة: الاستوديو يعدّ عرض الصورة كله هو عرض العلبة، فالمساحة الفارغة على الجانبين تُصغّر الساعة. نقصّ الحواف الفارغة تمامًا تلقائيًا دون أن يتغير شيء مما يُرى، أما الظل أو التوهج الخفيف على الجانبين فيوسّع الصورة دون الساعة — فنريك بكم في المئة من مقاسها الحقيقي تظهر، لتقصّها بحدّ واضح.', en: 'Crop each picture to the case’s edges: the studio takes the picture’s whole width as the case width, so empty space at the sides makes the watch smaller. We crop fully empty edges away for you, with nothing visible changed; a soft shadow or glow at the sides, though, widens the picture but not the watch — so we show what share of its real size it appears at, for you to crop it to a clean edge.' },
      { ar: 'نحفظ الصورة بصيغة WebP دون فقد حين تكون أصغر — نحو نصف الحجم بالبكسلات نفسها — فتفتح التجربة أسرع على جوال عميلك. وتُحسب الصور ضمن مساحة التخزين في باقتك.', en: 'We store a picture as lossless WebP when that is smaller — about half the size, with the same pixels — so the try-on opens faster on your shopper’s phone. The pictures count toward your plan’s storage.' },
      { ar: 'كل الباقات تجهّز ساعاتها للتجربة: يجرّبها المتسوق على النموذج ويقارن مقاسها. تجربتها على صورته هو تأتي مع باقتي «الاحترافية» و«المؤسسات». في كل ساعة ترى آخر 30 يومًا: عدد التجارب ومشاهدات المنتج والنسبة بينهما.', en: 'Every plan sets its watches up: shoppers try the watch on the model and compare its size. Trying it on their own photo comes with the Pro and Enterprise plans. Each watch shows its last 30 days: try-ons, product views and the two side by side.' },
    ],
  },
  {
    // P5.2/P5.4/P5.5/P5.6 (T68) — glasses, rings, necklaces and bags in the try-on settings, as built.
    slug: 'more-tryon-kinds', category: 'button', updated: '2026-10-03',
    title: { ar: 'تجهيز النظارات والخواتم والقلائد والحقائب للتجربة', en: 'Set up glasses, rings, necklaces and bags for the try-on' },
    summary: { ar: 'صورة واحدة بخلفية شفافة وعرض القطعة، لتظهر على عارضة حقيقية بحجمها الحقيقي.', en: 'One picture on a transparent background and the piece’s width, so it shows on a real model at its real size.' },
    steps: [
      { ar: 'اجعل نوع المنتج «نظارات» أو «مجوهرات» أو «حقائب» في صفحته، ثم افتح «التجربة الافتراضية».', en: 'Set the product’s type to Eyewear, Jewelry or Bag on its page, then open “Virtual try-on”.' },
      { ar: 'المجوهرات تشمل الخواتم والقلائد والأقراط والأساور، فحدّد في قائمة «مجوهراتك» ما كل قطعة: «هذا خاتم» أو «هذه قلادة» أو «هذا قرط».', en: 'Jewelry covers rings, necklaces, earrings and bracelets, so in the “Your jewelry” list say which each piece is: “It’s a ring”, “It’s a necklace” or “It’s an earring”.' },
      { ar: 'ارفع صورة واحدة: الإطار من الأمام بلا الذراعين، أو الخاتم من الأعلى والحلقة عرضيًا، أو القلادة على حامل والسلاسل متدلية، أو القرط الواحد من الأمام كما يتدلى، أو الحقيبة من الأمام والمقابض للأعلى.', en: 'Upload one picture: the frame from the front without the arms, the ring from above with the band running across, the necklace on a bust with the chains hanging, one earring from the front as it hangs, or the bag from the front with the handles up.' },
      { ar: 'أدخل العرض بالمليمتر وفعّل زر «جرّبها». يظهر في صفحة المنتج في متجرك بعد نشر إعداداتك.', en: 'Enter the width in millimetres and switch on the “Try it on” button. It appears on the product’s page in your store once your settings are published.' },
    ],
    body: [
      { ar: 'أي عرض ندخله: النظارة من مفصل إلى مفصل (100–170 مم)، والخاتم من طرف إلى طرف كما يظهر على الإصبع (14–30 مم)، والقلادة عند الرقبة من طرف إلى طرف (60–300 مم)، والحقيبة من جانب إلى جانب دون المقابض (100–600 مم).', en: 'Which width: glasses hinge to hinge (100–170 mm), a ring end to end as it sits on a finger (14–30 mm), a necklace across at the neck (60–300 mm), a bag side to side without the handles (100–600 mm).' },
      { ar: 'العارضات صور حقيقية مرخّصة، وكل صورة مقيسة لا مقدّرة بالعين: الوجه من المسافة بين الحدقتين، واليد من عرضها، والعارضة من طولها. فتُرسم قطعتك بعرضها على المقياس نفسه.', en: 'The models are real, licensed photos, each measured rather than judged by eye: a face from the distance between the pupils, a hand from its breadth, a model from her height. Your piece is drawn at its width on the same scale.' },
      { ar: 'نفحص الصورة كما نفحص الساعة: نقصّ الحواف الفارغة، ونريك بكم في المئة من حجمها الحقيقي تظهر، ويمكنك تحديد طرفيها بنفسك لقصّها بدقة.', en: 'We check the picture as we check a watch’s: empty edges cropped, the share of its real size shown, and you can mark its ends yourself to crop it exactly.' },
      { ar: 'في باقتي «الاحترافية» و«المؤسسات» يجرّب المتسوق النظارة والخاتم والقلادة والقرط والحقيبة على صورته هو أيضًا: نحدد الوجه أو اليد على جهازه (والأذن بنقرتين)، ولا تغادر الصورة جهازه.', en: 'On the Pro and Enterprise plans shoppers also try glasses, rings, necklaces, earrings and bags on their own photo: we find the face or the hand on their device (the ear with two taps), and the photo never leaves it.' },
    ],
  },
  {
    slug: 'trial-and-plans', category: 'billing', updated: '2026-09-26',
    title: { ar: 'التجربة المجانية وما بعدها', en: 'The free trial and what comes after' },
    summary: { ar: 'ماذا يحدث حين تنتهي الأيام الأربعة عشر.', en: 'What happens when the 14 days end.' },
    body: [
      { ar: 'نذكّرك قبل نهاية التجربة بثلاثة أيام وفي يومها الأخير. إذا انتهت دون اختيار باقة، يصبح متجرك «للاطلاع فقط»: لا يُحذف شيء، وتبقى الأرقام والتقارير متاحة، لكن التعديلات تتوقف حتى تختار باقة.', en: 'We remind you three days before the trial ends and on its last day. If it ends without a plan, your store becomes read-only: nothing is deleted and your figures and reports stay available, but changes pause until you choose a plan.' },
      { ar: 'الأسعار شهرية أو سنوية (السنوية بخصم شهرين)، وتُضاف إليها ضريبة القيمة المضافة 15% وتظهر منفصلة في كل فاتورة.', en: 'Prices are monthly or annual (annual saves two months), with 15% VAT added and shown separately on every invoice.' },
    ],
  },
  {
    slug: 'invoices', category: 'billing', updated: '2026-09-27',
    title: { ar: 'الفواتير الضريبية', en: 'Tax invoices' },
    summary: { ar: 'أين تجدها وما الذي تحتويه.', en: 'Where to find them and what they contain.' },
    body: [
      { ar: 'كل فواتيرك في «الاشتراك والفواتير»، بالعربية والإنجليزية معًا، ويمكن طباعتها أو حفظها PDF. إذا أدخلت رقمك الضريبي في بيانات المتجر تصدر فاتورتك «فاتورة ضريبية»، وإلا «فاتورة ضريبية مبسطة».', en: 'All your invoices are under “Billing”, in Arabic and English together, ready to print or save as PDF. If you add your VAT number in store details your invoice is a standard tax invoice; otherwise a simplified tax invoice.' },
      { ar: 'البائع في الفواتير هو شركة إس أر أو (SRO Company)، الرقم الضريبي 314550511700003.', en: 'The seller on invoices is SRO Company (شركة إس أر أو), VAT number 314550511700003.' },
    ],
  },
  {
    slug: 'ai-credits', category: 'billing', updated: '2026-09-29',
    title: { ar: 'أرصدة الذكاء الاصطناعي', en: 'AI credits' },
    summary: { ar: 'ما الذي يستهلكها ومتى تتجدد.', en: 'What uses them and when they renew.' },
    body: [
      { ar: 'توليد نموذج ثلاثي الأبعاد من الصور يستهلك 10 أرصدة. كل باقة تمنح أرصدة شهرية تنتهي بنهاية الشهر، والأرصدة المشتراة لا تنتهي بنهايته. إذا فشل التوليد يعود الرصيد تلقائيًا.', en: 'Generating a 3D model from photos uses 10 credits. Each plan grants monthly credits that expire at month end; purchased credits do not. If a generation fails, its credits come back automatically.' },
    ],
  },
  {
    slug: 'team-roles', category: 'account', updated: '2026-09-21',
    title: { ar: 'دعوة الفريق والصلاحيات', en: 'Inviting your team and roles' },
    summary: { ar: 'المالك والمسؤول والمحرّر والمحلّل والمشاهد.', en: 'Owner, admin, editor, analyst and viewer.' },
    body: [
      { ar: 'من «الفريق» أرسل دعوة بالبريد واختر الدور. المحرّر يعدّل المنتجات والنماذج، والمحلّل يرى التحليلات ويصدّرها، والمشاهد يطّلع فقط. الفوترة للمالك والمسؤول.', en: 'From “Team” send an email invitation and choose a role. Editors change products and models, analysts see and export analytics, viewers only look. Billing is for the owner and admins.' },
      { ar: 'في باقة «المؤسسات» يستطيع المالك والمسؤول إنشاء أدوار بأسمائكم، بتحديد ما يشمله كل دور من العمل على المنتجات والنماذج والتحليلات.', en: 'On the Enterprise plan, the owner and admins can also make roles with your own names, ticking which of the work on products, models and analytics each one covers.' },
    ],
  },
  {
    slug: 'single-sign-on', category: 'account', updated: '2026-09-30',
    title: { ar: 'الدخول بحساب شركتك (SSO)', en: 'Sign in with your company account (SSO)' },
    summary: { ar: 'يدخل فريقك بحساب Microsoft أو Google أو Okta — لباقة المؤسسات.', en: 'Your team signs in with its Microsoft, Google or Okta account — on the Enterprise plan.' },
    steps: [
      { ar: 'المالك أو المسؤول يفتح «الإعدادات» ثم «تسجيل الدخول الموحّد».', en: 'The owner or an admin opens “Settings”, then “Single sign-on”.' },
      { ar: 'في مزوّد شركتكم أنشئوا تطبيق OpenID Connect، وضعوا فيه عنوان الرجوع الظاهر في الصفحة.', en: 'At your company’s provider, create an OpenID Connect app and give it the redirect address shown on the page.' },
      { ar: 'انسخوا إلى تجربة عنوان المزوّد (Issuer) ومعرّف التطبيق والسر، وحدّدوا نطاقات بريدكم إن أردتم، ثم شغّلوه واحفظوا — نتأكد أن المزوّد يجيب قبل الحفظ.', en: 'Copy the issuer URL, client ID and secret into Tajribah, add your email domains if you want to, then turn it on and save — we check the provider answers before saving.' },
      { ar: 'يدخل فريقك من العنوان الذي يظهر بعد الحفظ، أو من «الدخول بحساب شركتك» في صفحة تسجيل الدخول.', en: 'Your team signs in at the address shown after saving, or from “Sign in with your company account” on the sign-in page.' },
    ],
    body: [
      { ar: 'يدخل به من دعوتموه إلى المتجر فقط؛ ادعُ الأعضاء من «الفريق» أولًا. والدخول الموحّد يفتح هذا المتجر وحده — لا المتاجر الأخرى للشخص ولا إعدادات حسابه؛ لتغيير التحقق بخطوتين مثلًا يدخل بالبريد وكلمة المرور.', en: 'Only people you have invited to the store can use it; invite members from “Team” first. And single sign-on opens this store alone — not the person’s other stores, nor their account settings; to change two-step sign-in, for example, they sign in with email and password.' },
      { ar: 'الدخول بكلمة المرور يبقى متاحًا كما هو.', en: 'Signing in with a password keeps working as before.' },
    ],
  },
  {
    slug: 'two-step', category: 'account', updated: '2026-09-23',
    title: { ar: 'تفعيل التحقق بخطوتين', en: 'Turn on two-step sign-in' },
    summary: { ar: 'رمز من تطبيق مصادقة بعد كلمة المرور.', en: 'A code from an authenticator app after your password.' },
    steps: [
      { ar: 'افتح «أمان تسجيل الدخول» وأدخل كلمة المرور.', en: 'Open “Sign-in security” and enter your password.' },
      { ar: 'امسح رمز QR بتطبيق مصادقة، ثم أدخل الرمز المكوّن من 6 أرقام.', en: 'Scan the QR code with an authenticator app, then enter the 6-digit code.' },
      { ar: 'احفظ رموز الاستعداد في مكان آمن؛ كل رمز يعمل مرة واحدة.', en: 'Keep the backup codes somewhere safe; each works once.' },
    ],
    body: [
      { ar: 'إذا فقدت جوالك ورموز الاستعداد، تواصل مع الدعم من البريد المسجّل في الحساب. نتحقق من هويتك قبل إيقاف التحقق بخطوتين، ونُنهي كل جلساتك ونرسل لك بريدًا بذلك.', en: 'If you lose your phone and your backup codes, contact support from the account’s email address. We confirm who you are before turning two-step off, end all your sessions and email you about it.' },
    ],
  },
  {
    slug: 'your-data', category: 'account', updated: '2026-09-27',
    title: { ar: 'طلب نسخة من بياناتك أو حذف حسابك', en: 'Request a copy of your data or delete your account' },
    summary: { ar: 'نردّ خلال 30 يومًا.', en: 'We reply within 30 days.' },
    body: [
      { ar: 'راسل الدعم من البريد المسجّل في حسابك. نرسل لك نسخة من بيانات حسابك في ملف واحد، أو نحذف الحساب ونجهّل بياناته. إن كنت مالك متجر، انقل الملكية أو أغلق المتجر أولًا لأن بيانات المتجر تخص المتجر.', en: 'Email support from your account’s address. We send a copy of your account data in one file, or delete the account and anonymise its data. If you own a store, transfer it or close it first, because the store’s data belongs to the store.' },
      { ar: 'بعض السجلات تُحفظ مددًا يفرضها النظام — الفواتير مثلًا ست سنوات على الأقل.', en: 'Some records are kept for periods the law requires — invoices, for example, at least six years.' },
    ],
  },
];

export const helpArticle = (slug: string) => HELP_ARTICLES.find((a) => a.slug === slug) ?? null;
