import type { Bi } from '@/lib/lang';

/**
 * Policy texts. Written for a Saudi SaaS under the Personal Data Protection
 * Law (PDPL) and the E-Commerce Law, and describing what this codebase really
 * does (on-device detection, 30-minute QR transfers, one language cookie).
 *
 * These are a considered starting point, not legal advice. Have them reviewed
 * by counsel licensed in the Kingdom before launch, and keep them in step with
 * the product: if the product starts storing something, the policy must say so.
 */
export type Block = { p: Bi } | { list: Bi[] };
export type Section = { id: string; h: Bi; body: Block[] };
export type Doc = { title: Bi; summary: Bi; sections: Section[] };

const p = (ar: string, en: string): Block => ({ p: { ar, en } });
const list = (...items: [string, string][]): Block => ({ list: items.map(([ar, en]) => ({ ar, en })) });

export const PRIVACY: Doc = {
  title: { ar: 'سياسة الخصوصية', en: 'Privacy policy' },
  summary: {
    ar: 'نجمع أقل قدر ممكن من البيانات. صور المتسوّقين تُحلَّل على أجهزتهم، ولا نبيع أي بيانات شخصية.',
    en: 'We collect as little as we can. Shoppers’ photos are analysed on their own devices, and we never sell personal data.',
  },
  sections: [
    { id: 'who', h: { ar: 'من نحن', en: 'Who we are' }, body: [
      p('«تجربة» منصة تقدّم للمتاجر الإلكترونية أدوات التجربة الافتراضية والمقارنة بالحجم الحقيقي. توضّح هذه السياسة كيف نتعامل مع البيانات الشخصية وفق نظام حماية البيانات الشخصية في المملكة العربية السعودية ولوائحه التنفيذية.',
        'Tajribah is a platform that gives online stores virtual try-on and true-size comparison tools. This policy explains how we handle personal data under the Saudi Personal Data Protection Law (PDPL) and its implementing regulations.'),
      p('نكون «جهة التحكم» في بيانات حسابات التجار وزوار موقعنا. أما بيانات المتسوّقين داخل متاجر عملائنا فنعالجها نيابة عن التاجر وبتعليماته، والتاجر هو جهة التحكم فيها.',
        'We are the controller of merchant-account data and of data about visitors to our website. Data about shoppers inside our customers’ stores we process on the merchant’s behalf and under their instructions; the merchant is its controller.'),
    ] },
    { id: 'collect', h: { ar: 'البيانات التي نجمعها', en: 'What we collect' }, body: [
      list(
        ['بيانات حساب التاجر: الاسم، البريد الإلكتروني، رقم الجوال، اسم المتجر ورابطه، وبيانات الفوترة.', 'Merchant account data: name, email, phone number, store name and URL, and billing details.'],
        ['بيانات المتجر عبر التكامل: المنتجات والصور والأسعار والمخزون، وبيانات الطلبات فقط إذا فعّل التاجر قياس التحويل.', 'Store data through integrations: products, images, prices and stock — and order data only if the merchant enables conversion measurement.'],
        ['بيانات الاستخدام في الاستوديو: أحداث مجهولة الهوية مثل فتح الاستوديو والطريقة المستخدمة ومدة الجلسة، ونوع الجهاز والمتصفح.', 'Studio usage data: anonymous events such as opening the studio, the mode used and session length, plus device and browser type.'],
        ['زوار الموقع: تفضيل اللغة فقط. رسائل نموذج التواصل تُرسل من تطبيق بريدك مباشرة، فنستلمها كرسالة بريد عادية.', 'Website visitors: your language preference only. Contact-form messages are sent from your own mail app, so we receive them as ordinary email.'],
      ),
      p('لا نجمع أرقام البطاقات البنكية؛ يتولى مزوّد الدفع معالجتها مباشرة.', 'We do not collect card numbers; our payment provider processes them directly.'),
    ] },
    { id: 'photos', h: { ar: 'الصور والكاميرا', en: 'Photos and camera' }, body: [
      p('حين يرفع المتسوّق صورة لمعصمه، يُحلَّل موضع اليد داخل متصفحه باستخدام نموذج يعمل على الجهاز، ولا تُرسل الصورة إلى خوادمنا. وحين ينقل صورة من جواله إلى حاسوبه عبر رمز QR، تُخزَّن مؤقتًا تحت رمز جلسة عشوائي وتُحذف فور استلامها أو بعد 30 دقيقة كحد أقصى.',
        'When a shopper uploads a wrist photo, the hand position is analysed inside their browser by an on-device model, and the photo is not sent to our servers. When they move a photo from phone to computer with a QR code, it is stored briefly under a random session code and deleted as soon as it is received, or after 30 minutes at most.'),
      p('لا نستخدم التعرّف على الوجه، ولا ننشئ بصمات حيوية، ولا نستخدم صور المتسوّقين في تدريب أي نموذج. التفاصيل في «خصوصية الكاميرا والصور».',
        'We do not use facial recognition, create biometric templates, or use shoppers’ photos to train any model. Details are in “Camera & photo privacy”.'),
    ] },
    { id: 'use', h: { ar: 'كيف نستخدم البيانات', en: 'How we use data' }, body: [
      list(
        ['تقديم الخدمة وتشغيل حساب التاجر.', 'To provide the service and run the merchant account.'],
        ['الفوترة وإصدار الفواتير الضريبية.', 'For billing and issuing tax invoices.'],
        ['عرض الإحصاءات للتاجر عن استخدام التجربة وأثرها.', 'To show merchants statistics on try-on use and its effect.'],
        ['الدعم الفني والتواصل بشأن الحساب.', 'For technical support and account communication.'],
        ['حماية الخدمة من إساءة الاستخدام والوفاء بالالتزامات النظامية.', 'To protect the service from abuse and meet legal obligations.'],
      ),
    ] },
    { id: 'basis', h: { ar: 'الأساس النظامي للمعالجة', en: 'Legal basis' }, body: [
      p('نعالج البيانات بناءً على تنفيذ العقد مع التاجر، أو الوفاء بالتزام نظامي، أو المصلحة المشروعة التي لا تمس حقوق صاحب البيانات، أو موافقته حين تكون الموافقة هي الأساس المناسب. ويحق لك سحب موافقتك في أي وقت.',
        'We process data to perform our contract with the merchant, to meet a legal obligation, for a legitimate interest that does not override the data subject’s rights, or with consent where consent is the right basis. You may withdraw consent at any time.'),
    ] },
    { id: 'share', h: { ar: 'مشاركة البيانات', en: 'Sharing' }, body: [
      p('لا نبيع البيانات الشخصية ولا نؤجّرها. نشاركها فقط مع مزوّدي خدمات يعملون لصالحنا بموجب اتفاقيات تلزمهم بحمايتها، مثل مزوّد الاستضافة والتخزين السحابي ومزوّد الدفع ومزوّد البريد الإلكتروني، أو مع الجهات الرسمية حين يقتضي النظام ذلك.',
        'We do not sell or rent personal data. We share it only with service providers working for us under agreements that bind them to protect it — such as our hosting and cloud-storage provider, payment provider and email provider — or with authorities where the law requires.'),
    ] },
    { id: 'transfer', h: { ar: 'نقل البيانات خارج المملكة', en: 'Transfers outside the Kingdom' }, body: [
      p('قد يستضيف بعض مزوّدي الخدمة البيانات خارج المملكة. في هذه الحالة نلتزم بالضوابط التي يفرضها النظام ولائحة نقل البيانات الشخصية خارج المملكة، ونكتفي بالحد الأدنى اللازم.',
        'Some service providers may host data outside the Kingdom. Where they do, we follow the conditions set by the PDPL and its regulation on transferring personal data abroad, and transfer only the minimum needed.'),
    ] },
    { id: 'retention', h: { ar: 'مدة الاحتفاظ', en: 'Retention' }, body: [
      list(
        ['بيانات حساب التاجر: طوال مدة الاشتراك، ثم للمدة التي تفرضها الأنظمة، كالأنظمة الضريبية.', 'Merchant account data: for the life of the subscription, then as long as the law requires, for example tax rules.'],
        ['إحصاءات الاستخدام: تُجمَّع ولا تُربط بأشخاص.', 'Usage statistics: aggregated and not tied to individuals.'],
        ['الصور المنقولة عبر رمز QR: حتى استلامها، ولا تتجاوز 30 دقيقة.', 'Photos transferred by QR code: until received, never more than 30 minutes.'],
      ),
    ] },
    { id: 'rights', h: { ar: 'حقوقك', en: 'Your rights' }, body: [
      p('يكفل لك النظام الحق في العلم بكيفية معالجة بياناتك، والوصول إليها والحصول على نسخة منها، وتصحيحها أو استكمالها، وطلب إتلافها حين لا تعود لازمة، وسحب موافقتك. ولك تقديم شكوى إلى الهيئة السعودية للبيانات والذكاء الاصطناعي (سدايا).',
        'The PDPL gives you the right to know how your data is processed, to access it and obtain a copy, to have it corrected or completed, to ask for its destruction when no longer needed, and to withdraw consent. You may also complain to the Saudi Data & AI Authority (SDAIA).'),
      p('إن كنت متسوّقًا في متجر يستخدم تجربة، فوجّه طلبك إلى ذلك المتجر أولًا، وسنساعده في تنفيذه.', 'If you are a shopper in a store that uses Tajribah, send your request to that store first; we will help them fulfil it.'),
    ] },
    { id: 'security', h: { ar: 'أمن البيانات', en: 'Security' }, body: [
      p('نستخدم التشفير أثناء النقل، وعزلًا صارمًا بين بيانات المتاجر في قاعدة البيانات، وصلاحيات وصول بالحد الأدنى. وإن وقع حادث يمس بياناتك، نبلغ الجهات المختصة ونبلغك وفق ما يقتضيه النظام.',
        'We use encryption in transit, strict isolation between stores’ data in the database, and least-privilege access. If an incident affects your data, we notify the competent authority and you as the law requires.'),
    ] },
    { id: 'children', h: { ar: 'الأطفال', en: 'Children' }, body: [
      p('حسابات التجار مخصصة لمن بلغوا 18 عامًا. ولا نجمع عن قصد بيانات شخصية لأطفال.', 'Merchant accounts are for people aged 18 and over. We do not knowingly collect personal data about children.'),
    ] },
    { id: 'changes', h: { ar: 'تحديث السياسة', en: 'Changes' }, body: [
      p('سنعدّل هذه السياسة حين يتغير ما نفعله. نغيّر تاريخ «آخر تحديث» أعلاه، ونبلغ التجار بالتغييرات الجوهرية قبل سريانها.', 'We will update this policy when what we do changes. We change the “last updated” date above and tell merchants about material changes before they take effect.'),
    ] },
  ],
};

export const TRYON: Doc = {
  title: { ar: 'خصوصية الكاميرا والصور', en: 'Camera & photo privacy' },
  summary: {
    ar: 'صورتك للتجربة فقط. نحلّلها على جهازك، ولا نتعرّف عليك منها، ولا نحتفظ بها.',
    en: 'Your photo is for the try-on only. We analyse it on your device, we don’t identify you from it, and we don’t keep it.',
  },
  sections: [
    { id: 'short', h: { ar: 'باختصار', en: 'In short' }, body: [
      list(
        ['تحديد المعصم يتم داخل متصفحك.', 'Wrist detection runs inside your browser.'],
        ['الصورة المرفوعة لا تُرسل إلى خوادمنا.', 'An uploaded photo is not sent to our servers.'],
        ['النقل من الجوال عبر رمز QR مؤقت: 30 دقيقة كحد أقصى.', 'Phone transfer by QR code is temporary: 30 minutes at most.'],
        ['لا تعرّف على الوجوه، ولا بصمات حيوية، ولا تدريب نماذج على صورك.', 'No facial recognition, no biometric templates, no training models on your photos.'],
      ),
    ] },
    { id: 'upload', h: { ar: 'حين ترفع صورة', en: 'When you upload a photo' }, body: [
      p('يصغّر متصفحك الصورة ويحوّلها، ثم يحمّل نموذج تحديد اليد إلى جهازك ليحدّد موضع المعصم. كل ذلك يحدث على جهازك، وتبقى الصورة في صفحة المتصفح حتى تغلقها.',
        'Your browser resizes and converts the photo, then loads the hand-detection model onto your device to find your wrist. All of this happens on your device, and the photo stays in the browser page until you close it.'),
    ] },
    { id: 'qr', h: { ar: 'حين تستخدم جوالك عبر رمز QR', en: 'When you use your phone via QR code' }, body: [
      p('يُنشأ رمز جلسة عشوائي بطول 128 بت. تلتقط الصورة بجوالك، فتُضغط وتُرفع إلى تخزين مؤقت لا يمكن الوصول إليه إلا بذلك الرمز. يستلمها حاسوبك ثم تُحذف فورًا. وإن لم تُستلم، تنتهي الجلسة وتُحذف بعد 30 دقيقة.',
        'A random 128-bit session code is created. You take the photo on your phone; it is compressed and uploaded to temporary storage that can be reached only with that code. Your computer receives it and it is deleted at once. If it is never received, the session expires and it is deleted after 30 minutes.'),
    ] },
    { id: 'camera', h: { ar: 'الكاميرا', en: 'Camera' }, body: [
      p('لا نفتح الكاميرا إلا حين تختار ذلك، ويطلب متصفحك إذنك أولًا. يمكنك سحب الإذن من إعدادات المتصفح في أي وقت.', 'We open the camera only when you choose to, and your browser asks your permission first. You can withdraw permission in your browser settings at any time.'),
    ] },
    { id: 'saved', h: { ar: 'الصورة التي تحفظها', en: 'Images you save' }, body: [
      p('حين تضغط «احفظ إطلالتك» تُنشأ الصورة على جهازك وتُحفظ فيه مباشرة، ولا نحتفظ بنسخة منها.', 'When you press “Save your look”, the image is created on your device and saved straight to it. We keep no copy.'),
    ] },
    { id: 'usage', h: { ar: 'بيانات الاستخدام', en: 'Usage data' }, body: [
      p('قد نسجّل أحداثًا مجهولة الهوية لا تتضمن الصورة، مثل فتح الاستوديو والطريقة المستخدمة، ليعرف المتجر مدى فائدة التجربة.', 'We may record anonymous events that never include the photo — such as opening the studio and the mode used — so the store can see how useful try-on is.'),
    ] },
    { id: 'store', h: { ar: 'المتجر الذي تشتري منه', en: 'The store you buy from' }, body: [
      p('مشترياتك وبيانات طلبك تخضع لسياسة خصوصية المتجر نفسه. تجربة أداة داخل صفحة المنتج، ولا ترى بيانات الدفع.', 'Your purchase and order details are governed by the store’s own privacy policy. Tajribah is a tool inside the product page and never sees payment data.'),
    ] },
  ],
};

export const TERMS: Doc = {
  title: { ar: 'الشروط والأحكام', en: 'Terms of service' },
  summary: {
    ar: 'تنظّم هذه الشروط استخدام التجار لمنصة تجربة واشتراكهم فيها.',
    en: 'These terms govern how merchants use and subscribe to the Tajribah platform.',
  },
  sections: [
    { id: 'accept', h: { ar: 'القبول', en: 'Acceptance' }, body: [
      p('بإنشاء حساب أو استخدام المنصة فإنك توافق على هذه الشروط. إن كنت تتصرف نيابة عن منشأة، فأنت تقرّ بأن لديك صلاحية إلزامها بها.', 'By creating an account or using the platform you agree to these terms. If you act for a business, you confirm you have authority to bind it.'),
    ] },
    { id: 'defs', h: { ar: 'التعريفات', en: 'Definitions' }, body: [
      list(
        ['«المنصة»: خدمة تجربة، بما فيها لوحة التحكم والاستوديو وواجهات البرمجة.', '“Platform”: the Tajribah service, including the dashboard, the studio and the APIs.'],
        ['«التاجر»: صاحب الحساب الذي يستخدم المنصة في متجره.', '“Merchant”: the account holder using the platform in their store.'],
        ['«المتسوّق»: زائر متجر التاجر الذي يستخدم الاستوديو.', '“Shopper”: a visitor to the merchant’s store who uses the studio.'],
        ['«محتوى التاجر»: صور المنتجات وأبعادها وأوصافها وأي مواد يرفعها التاجر.', '“Merchant content”: product images, dimensions, descriptions and any material the merchant uploads.'],
      ),
    ] },
    { id: 'service', h: { ar: 'الخدمة', en: 'The service' }, body: [
      p('توفّر المنصة أدوات لعرض المنتجات بحجمها الحقيقي وتجربتها افتراضيًا داخل صفحات منتجات التاجر، وفق ما تتضمنه الباقة المختارة. قد نطوّر المزايا أو نعدّلها، ولن نلغي ميزة جوهرية في باقة مدفوعة دون إشعار مسبق معقول.',
        'The platform provides tools to show products at true size and try them on virtually inside the merchant’s product pages, as included in the chosen plan. We may develop or change features, and we will not remove a core feature from a paid plan without reasonable prior notice.'),
    ] },
    { id: 'account', h: { ar: 'الحساب', en: 'Your account' }, body: [
      p('تلتزم بتقديم معلومات صحيحة والحفاظ على سرية بيانات الدخول، وتتحمل مسؤولية كل ما يتم عبر حسابك. أبلغنا فورًا بأي استخدام غير مصرح به.', 'You agree to give accurate information and keep your login secure, and you are responsible for activity under your account. Tell us at once about any unauthorised use.'),
    ] },
    { id: 'billing', h: { ar: 'الاشتراكات والدفع', en: 'Subscriptions and payment' }, body: [
      list(
        ['الاشتراك شهري ويُجدَّد تلقائيًا حتى تلغيه.', 'Subscriptions are monthly and renew automatically until cancelled.'],
        ['الأسعار بالريال السعودي، وتُضاف إليها ضريبة القيمة المضافة.', 'Prices are in Saudi riyals, with VAT added.'],
        ['نُشعرك قبل 30 يومًا على الأقل من أي زيادة في سعر باقتك.', 'We give at least 30 days’ notice before any increase in your plan’s price.'],
        ['الإلغاء والاسترداد وفق سياسة الإلغاء والاسترداد.', 'Cancellation and refunds follow the cancellation and refund policy.'],
      ),
    ] },
    { id: 'merchant', h: { ar: 'التزامات التاجر', en: 'Merchant obligations' }, body: [
      list(
        ['أن تملك حقوق محتواك أو تملك إذنًا باستخدامه، بما في ذلك صور المنتجات.', 'You own your content or have permission to use it, including product images.'],
        ['أن تكون أبعاد المنتجات التي تدخلها صحيحة؛ فدقة العرض تعتمد عليها.', 'The product dimensions you enter are correct — the accuracy of what shoppers see depends on them.'],
        ['أن تلتزم بنظام التجارة الإلكترونية وسائر الأنظمة المطبقة على متجرك.', 'You comply with the E-Commerce Law and all other rules that apply to your store.'],
        ['أن تذكر في سياسة خصوصية متجرك استخدامك لأدوات التجربة الافتراضية.', 'Your store’s privacy policy mentions that you use virtual try-on tools.'],
      ),
    ] },
    { id: 'use', h: { ar: 'الاستخدام المقبول', en: 'Acceptable use' }, body: [
      p('لا يجوز استخدام المنصة لعرض منتجات مخالفة للأنظمة، أو لمحاولة الوصول إلى بيانات متاجر أخرى، أو لتعطيل الخدمة، أو لنسخها أو إعادة بيعها دون اتفاق مكتوب.', 'You may not use the platform to show unlawful products, to try to reach other stores’ data, to disrupt the service, or to copy or resell it without a written agreement.'),
    ] },
    { id: 'ip', h: { ar: 'الملكية الفكرية', en: 'Intellectual property' }, body: [
      p('المنصة وتصاميمها وشيفرتها ملك لتجربة. ويبقى محتواك ملكًا لك، وتمنحنا ترخيصًا محدودًا لمعالجته وعرضه بالقدر اللازم لتقديم الخدمة طوال مدة اشتراكك.', 'The platform, its designs and code belong to Tajribah. Your content stays yours; you grant us a limited licence to process and display it as needed to provide the service for as long as you subscribe.'),
    ] },
    { id: 'preview', h: { ar: 'طبيعة المعاينة', en: 'Nature of the preview' }, body: [
      p('العرض بالحجم الحقيقي وعلى العارضة مبني على الأبعاد التي يدخلها التاجر. أما التجربة على صورة المتسوّق فدليل مرئي تقريبي، ولا تضمن المنصة ملاءمة المقاس لشخص بعينه.', 'The true-size and on-model views are built from the dimensions the merchant enters. Trying on a shopper’s own photo is an approximate visual guide, and the platform does not guarantee fit for any particular person.'),
    ] },
    { id: 'availability', h: { ar: 'التوفر', en: 'Availability' }, body: [
      p('نسعى إلى إبقاء المنصة متاحة باستمرار، وقد تتوقف مؤقتًا للصيانة أو لأسباب خارجة عن إرادتنا. صُمّم زر المتجر ليستمر في العمل حتى إن توقفت لوحة التحكم.', 'We aim to keep the platform continuously available; it may pause for maintenance or for reasons beyond our control. The store button is designed to keep working even if the dashboard is down.'),
    ] },
    { id: 'liability', h: { ar: 'حدود المسؤولية', en: 'Limitation of liability' }, body: [
      p('في الحدود التي يسمح بها النظام، لا نتحمل المسؤولية عن الأضرار غير المباشرة أو فوات الأرباح، ولا تتجاوز مسؤوليتنا الإجمالية المبالغ التي دفعتها لنا خلال الأشهر الاثني عشر السابقة للمطالبة.', 'To the extent the law allows, we are not liable for indirect loss or lost profit, and our total liability does not exceed what you paid us in the 12 months before the claim.'),
    ] },
    { id: 'termination', h: { ar: 'الإنهاء', en: 'Termination' }, body: [
      p('يمكنك إنهاء اشتراكك في أي وقت. ويحق لنا تعليق الحساب أو إنهاؤه عند مخالفة جوهرية لهذه الشروط بعد إشعارك ومنحك مهلة معقولة للتصحيح، ما لم تكن المخالفة جسيمة. عند الإنهاء يمكنك طلب نسخة من بياناتك خلال 30 يومًا.', 'You may end your subscription at any time. We may suspend or end an account for a material breach of these terms after notice and a reasonable chance to fix it, unless the breach is serious. After termination you can request a copy of your data within 30 days.'),
    ] },
    { id: 'law', h: { ar: 'النظام الواجب التطبيق', en: 'Governing law' }, body: [
      p('تخضع هذه الشروط لأنظمة المملكة العربية السعودية، وتختص محاكمها بالنظر في أي نزاع ينشأ عنها، بعد السعي إلى حلّه وديًا.', 'These terms are governed by the laws of the Kingdom of Saudi Arabia, whose courts have jurisdiction over any dispute, after an attempt to settle it amicably.'),
    ] },
    { id: 'changes', h: { ar: 'تعديل الشروط', en: 'Changes to these terms' }, body: [
      p('نُشعر التجار بأي تعديل جوهري قبل 30 يومًا من سريانه. واستمرارك في استخدام المنصة بعد ذلك يعني قبولك للتعديل.', 'We notify merchants of material changes 30 days before they take effect. Continuing to use the platform afterwards means you accept them.'),
    ] },
  ],
};

export const REFUND: Doc = {
  title: { ar: 'سياسة الإلغاء والاسترداد', en: 'Cancellation & refund policy' },
  summary: {
    ar: 'ألغِ متى شئت. نستردّ لك الاشتراك الأول كاملًا خلال 7 أيام إن لم تنشر التجربة في متجرك بعد.',
    en: 'Cancel whenever you like. Your first subscription is fully refunded within 7 days if you haven’t published try-on in your store yet.',
  },
  sections: [
    { id: 'cancel', h: { ar: 'الإلغاء', en: 'Cancelling' }, body: [
      p('يمكنك إلغاء اشتراكك في أي وقت من لوحة التحكم أو بمراسلتنا. يسري الإلغاء في نهاية فترة الفوترة الحالية، ويستمر الزر في العمل حتى نهايتها، ولا نحصّل أي مبالغ بعدها.', 'You can cancel any time from the dashboard or by emailing us. Cancellation takes effect at the end of the current billing period; the button keeps working until then and nothing further is charged.'),
    ] },
    { id: 'first', h: { ar: 'استرداد الاشتراك الأول', en: 'First-subscription refund' }, body: [
      p('إن طلبت الاسترداد خلال 7 أيام من أول دفعة ولم تكن قد نشرت زر التجربة في متجرك المباشر، نردّ المبلغ كاملًا.', 'If you ask within 7 days of your first payment and have not published the try-on button in your live store, we refund the full amount.'),
    ] },
    { id: 'after', h: { ar: 'بعد ذلك', en: 'After that' }, body: [
      p('لا تُسترد مبالغ الفترة الجارية جزئيًا عند الإلغاء، لأن الخدمة تبقى متاحة حتى نهايتها.', 'The current period is not partly refunded on cancellation, because the service stays available until it ends.'),
    ] },
    { id: 'addons', h: { ar: 'الإضافات والخدمات', en: 'Add-ons and services' }, body: [
      list(
        ['أرصدة الذكاء الاصطناعي المستخدمة لا تُسترد، وغير المستخدمة تُسترد خلال 7 أيام من شرائها.', 'Used AI credits are not refundable; unused credits are refundable within 7 days of purchase.'],
        ['النمذجة ثلاثية الأبعاد الاحترافية تُسترد كاملة قبل بدء العمل، ولا تُسترد بعد تسليم النموذج.', 'Professional 3D modelling is fully refundable before work starts and not refundable after the model is delivered.'],
      ),
    ] },
    { id: 'errors', h: { ar: 'أخطاء الفوترة', en: 'Billing errors' }, body: [
      p('إن حُصّل منك مبلغ مكرر أو خاطئ، نردّه كاملًا فور التحقق منه.', 'If you are charged twice or in error, we refund it in full as soon as we confirm it.'),
    ] },
    { id: 'plan', h: { ar: 'تغيير الباقة', en: 'Changing plans' }, body: [
      p('الترقية تسري فورًا ويُحتسب الفرق عن الأيام المتبقية. التخفيض يسري من بداية الفترة التالية.', 'Upgrades take effect immediately and the difference is charged for the remaining days. Downgrades take effect from the next period.'),
    ] },
    { id: 'how', h: { ar: 'طريقة الاسترداد', en: 'How refunds are paid' }, body: [
      p('تُعاد المبالغ إلى وسيلة الدفع الأصلية خلال 14 يوم عمل من الموافقة، وقد يختلف موعد ظهورها بحسب البنك.', 'Refunds go back to the original payment method within 14 business days of approval; when they appear depends on your bank.'),
    ] },
  ],
};

export const COOKIES: Doc = {
  title: { ar: 'سياسة ملفات تعريف الارتباط', en: 'Cookie policy' },
  summary: {
    ar: 'نستخدم ملفًا واحدًا لتذكّر لغتك. لا ملفات إعلانية ولا تتبّع من أطراف ثالثة.',
    en: 'We use one cookie to remember your language. No advertising cookies and no third-party tracking.',
  },
  sections: [
    { id: 'what', h: { ar: 'ما هي ملفات تعريف الارتباط', en: 'What cookies are' }, body: [
      p('ملفات صغيرة يحفظها المتصفح ليتذكّر معلومات بين الزيارات. ويشبهها «التخزين المحلي» في المتصفح، ونشملهما معًا في هذه السياسة.', 'Small files your browser keeps to remember information between visits. Browser “local storage” works similarly, and this policy covers both.'),
    ] },
    { id: 'ours', h: { ar: 'ما نستخدمه', en: 'What we use' }, body: [
      list(
        ['tajribah-lang: يتذكّر لغتك المفضّلة (العربية أو الإنجليزية) لمدة 12 شهرًا. ضروري لعرض الموقع بلغتك.', 'tajribah-lang: remembers your preferred language (Arabic or English) for 12 months. Needed to show the site in your language.'],
        ['ملفات أمان ضرورية قد يضعها مزوّد الاستضافة لحماية الموقع من الهجمات.', 'Strictly necessary security cookies our hosting provider may set to protect the site from attack.'],
      ),
      p('لا نستخدم حاليًا ملفات للإعلانات أو لتحليلات أطراف ثالثة. وإن أضفناها لاحقًا، سنطلب موافقتك أولًا ونحدّث هذه السياسة.', 'We do not currently use advertising or third-party analytics cookies. If we add any, we will ask for your consent first and update this policy.'),
    ] },
    { id: 'fonts', h: { ar: 'الخطوط', en: 'Fonts' }, body: [
      p('نحمّل خطوط الموقع من خدمة Google Fonts، فيتلقى خادمها عنوان IP الخاص بجهازك ليرسل ملفات الخط. لا تضع هذه الخدمة ملفات تعريف ارتباط على موقعنا.', 'We load the site’s fonts from Google Fonts, whose server receives your device’s IP address in order to send the font files. The service does not set cookies on our site.'),
    ] },
    { id: 'control', h: { ar: 'التحكم', en: 'Your control' }, body: [
      p('يمكنك حذف ملفات تعريف الارتباط أو حظرها من إعدادات متصفحك. إن حذفت ملف اللغة، يعود الموقع إلى العربية.', 'You can delete or block cookies in your browser settings. If you delete the language cookie, the site returns to Arabic.'),
    ] },
  ],
};
