import type { Bi } from '@/lib/lang';

/**
 * Help centre (Track M, M8). Every article describes the merchant dashboard as it is built
 * (tajribah-platform): the onboarding steps, the connection, 3D models and versions, the AR
 * button, the embed line, team roles, two-step sign-in, plans, the 14-day trial and what happens
 * after it, invoices with 15% VAT, AI credits, and privacy requests (30 days). Nothing here
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
  { key: 'connect', title: { ar: 'ربط المتجر', en: 'Connecting your store' }, blurb: { ar: 'سلة وزد وسطر التضمين لأي متجر آخر.', en: 'Salla, Zid, and the embed line for any other store.' } },
  { key: 'models', title: { ar: 'المنتجات والنماذج', en: 'Products and 3D models' }, blurb: { ar: 'المقاسات والنماذج ثلاثية الأبعاد ونسخها.', en: 'Sizes, 3D models and their versions.' } },
  { key: 'button', title: { ar: 'الزر والتجربة', en: 'The button and try-on' }, blurb: { ar: 'شكل الزر ورموز QR وما يراه العميل.', en: 'Button style, QR codes and what shoppers see.' } },
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
      { ar: 'تبدأ كل المتاجر بباقة المبتدئة في فترة تجربة مجانية لمدة 14 يومًا، دون بطاقة دفع. تظهر المدة المتبقية أسفل القائمة الجانبية.', en: 'Every store starts on the Starter plan with a 14-day free trial and no card required. The days left show at the bottom of the side menu.' },
      { ar: 'يمكنك تخطي أي خطوة إعداد والعودة إليها لاحقًا من «دليل الإعداد».', en: 'You can skip any setup step and come back to it later from the “Setup guide”.' },
    ],
  },
  {
    slug: 'setup-checklist', category: 'start', updated: '2026-09-20',
    title: { ar: 'خطوات الإعداد الست', en: 'The six setup steps' },
    summary: { ar: 'ما الذي تطلبه كل خطوة ولماذا.', en: 'What each step asks for, and why.' },
    body: [
      { ar: 'إنشاء الحساب، ثم بيانات المتجر (الاسم والسجل التجاري والرقم الضريبي إن وُجد — تظهر في فواتيرك)، ثم ربط المتجر، ثم مراجعة المقاسات، ثم أول نموذج ثلاثي الأبعاد، ثم تركيب الزر في متجرك.', en: 'Create the account; store details (name, CR and VAT number if you have one — they appear on your invoices); connect your store; check your dimensions; your first 3D model; install the button in your store.' },
      { ar: 'خطوة المقاسات هي الأهم: المقارنة بالحجم الحقيقي لا تظهر لمنتج بلا عرض وارتفاع بالمليمتر، حتى لا يرى عميلك رقمًا غير دقيق.', en: 'The dimensions step matters most: true-size comparison does not show for a product without a width and height in millimetres, so your shopper never sees a wrong number.' },
    ],
  },
  {
    slug: 'connect-salla', category: 'connect', updated: '2026-09-24',
    title: { ar: 'ربط متجرك على سلة', en: 'Connect your Salla store' },
    summary: { ar: 'موافقة واحدة، ثم تُستورد منتجاتك وتبقى محدّثة.', en: 'One approval, then your products import and stay current.' },
    steps: [
      { ar: 'من لوحة التحكم افتح «ربط المتجر» واختر سلة.', en: 'In the dashboard open “Store connections” and choose Salla.' },
      { ar: 'سجّل الدخول إلى سلة ووافق على الصلاحيات المطلوبة.', en: 'Sign in to Salla and approve the requested permissions.' },
      { ar: 'تبدأ أول مزامنة تلقائيًا، وترى تقدّمها في الصفحة نفسها.', en: 'The first sync starts on its own; you can watch its progress on the same page.' },
    ],
    body: [
      { ar: 'بعد الربط، يصلنا أي تعديل على منتج في سلة تلقائيًا، وتجري مزامنة دورية أيضًا تحسّبًا لأي تعديل فاتنا.', en: 'Once connected, product edits in Salla reach us automatically, and a scheduled sync also runs in case anything was missed.' },
      { ar: 'إذا توقف الاتصال (مثلًا بعد إلغاء التطبيق من سلة) تظهر الحالة «يحتاج إعادة ربط» مع زر لإعادة الربط.', en: 'If the connection stops (for example after removing the app in Salla), the status shows “Needs reconnecting” with a button to reconnect.' },
    ],
  },
  {
    slug: 'connect-zid', category: 'connect', updated: '2026-09-24',
    title: { ar: 'ربط متجرك على زد', en: 'Connect your Zid store' },
    summary: { ar: 'الخطوات نفسها كسلة، من سوق تطبيقات زد.', en: 'The same steps as Salla, from the Zid app market.' },
    steps: [
      { ar: 'افتح «ربط المتجر» واختر زد.', en: 'Open “Store connections” and choose Zid.' },
      { ar: 'وافق على الصلاحيات من حسابك في زد.', en: 'Approve the permissions from your Zid account.' },
      { ar: 'انتظر اكتمال أول مزامنة، ثم راجع المقاسات.', en: 'Wait for the first sync to finish, then check your dimensions.' },
    ],
    body: [
      { ar: 'نعمل حاليًا مع المتاجر الأولى بالتنسيق المباشر؛ إن لم يظهر لك خيار زد بعد، تواصل معنا لنفعّله لمتجرك.', en: 'We are onboarding our first stores directly; if the Zid option is not showing for you yet, contact us and we will enable it for your store.' },
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
    slug: 'qr-codes', category: 'button', updated: '2026-09-19',
    title: { ar: 'رموز QR للمنتجات', en: 'QR codes for products' },
    summary: { ar: 'للواجهات والكتالوجات المطبوعة.', en: 'For shop windows and printed catalogues.' },
    body: [
      { ar: 'لكل منتج مفعّل رمز QR يفتح صفحة التجربة مباشرة. نزّله من «رموز QR» واطبعه على البطاقة أو الكتالوج؛ الرمز يبقى صالحًا ما دام المنتج مفعّلًا.', en: 'Every enabled product has a QR code that opens its try-on page directly. Download it from “QR codes” and print it on a card or catalogue; it keeps working as long as the product is enabled.' },
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
