import type { Bi } from '@site/lib/lang';

/**
 * A page per capability (Track M, M5). The overview at `/features` says what the four ways to
 * try are; these pages say how each one works, what the merchant has to do for it, and — the
 * section that matters most — what it does *not* do.
 *
 * Every claim here describes the studio as it is built today (`components/studio/Studio.tsx`,
 * and the camera and photo policy in `content/legal.ts`). Nothing is aspirational unless it is
 * marked `soon`, and no effect, percentage or customer is invented (CLAUDE.md rules 2 and 5).
 */
export type FeatureSlug = 'on-model' | 'on-me' | 'true-size' | 'phone-handoff';

export type FeaturePage = {
  slug: FeatureSlug;
  /** Short label, for the cards on `/features` and the cross-links at the foot of each page. */
  nav: Bi;
  icon: 'hand' | 'camera' | 'ruler' | 'qr';
  hero: { title: Bi; lead: Bi };
  /** What the shopper actually does, in order. */
  steps: { title: Bi; body: Bi }[];
  /** How it works underneath — the part a merchant asks about before trusting it. */
  how: { title: Bi; body: Bi }[];
  /** What the merchant sets up for this mode. */
  setup: Bi[];
  /** What it does not do. Written plainly; a limit found on the page beats one found later. */
  limits: Bi[];
  faq: { q: Bi; a: Bi }[];
};

export const FEATURE_PAGES: Record<FeatureSlug, FeaturePage> = {
  'on-model': {
    slug: 'on-model',
    nav: { ar: 'العرض على العارضة', en: 'On model' },
    icon: 'hand',
    hero: {
      title: { ar: 'القطعة على معصم حقيقي، بالحجم الصحيح', en: 'The piece on a real wrist, at the right size' },
      lead: {
        ar: 'صورتان حقيقيتان لمعصم عارضة، والقطعة عليهما بمقاسها المُدخَل بالمليمتر. يحرّكها العميل على المعصم حتى تستقر، فيرى كيف ستبدو قبل أن يشتري.',
        en: 'Two real photographs of a model’s wrist, with the piece on them at the size you entered in millimetres. Shoppers slide it along the wrist until it sits right, and see how it will look before they buy.',
      },
    },
    steps: [
      { title: { ar: 'يفتح الاستوديو', en: 'Open the studio' }, body: { ar: 'من زر «جرّبها» في صفحة المنتج. يبدأ العرض على العارضة مباشرة، دون كاميرا ودون إذن ودون تسجيل دخول.', en: 'From the “Try it on” button on the product page. It opens on the model view at once — no camera, no permission prompt, no sign-in.' } },
      { title: { ar: 'يختار الصورة الأقرب', en: 'Pick the closer shot' }, body: { ar: 'معصم عن قرب لرؤية التفاصيل، أو إطلالة يومية لرؤية القطعة ضمن المشهد.', en: 'A wrist close-up for the detail, or a lifestyle shot to see the piece in context.' } },
      { title: { ar: 'يحرّكها حتى تستقر', en: 'Move it until it sits right' }, body: { ar: 'سحب على طول المعصم، وتدوير، وتكبير. لا تخرج القطعة عن المعصم مهما سُحبت.', en: 'Drag along the wrist, rotate, zoom. The piece cannot be dragged off the wrist, however hard you try.' } },
      { title: { ar: 'يقارن أو يجرّب على صورته', en: 'Compare, or try it on themselves' }, body: { ar: 'من الاستوديو نفسه ينتقل إلى المقارنة بالحجم الحقيقي أو إلى التجربة على صورته، دون مغادرة صفحة المنتج.', en: 'From the same studio they move to the true-size comparison or to their own photo, without leaving the product page.' } },
    ],
    how: [
      { title: { ar: 'مقياس معروف في الصورة', en: 'A known scale in the photograph' }, body: { ar: 'صورة العارضة مُقاسة: كل مليمتر فيها يساوي عددًا ثابتًا من البكسلات. لذلك تظهر ساعة قطرها 40 مم أكبر من ساعة قطرها 36 مم بالنسبة نفسها تمامًا على المعصم.', en: 'The model photograph is measured: every millimetre in it is a fixed number of pixels. So a 40 mm watch covers more of the wrist than a 36 mm one, in exactly the right proportion.' } },
      { title: { ar: 'القطعة تلتزم بالمعصم', en: 'The piece stays on the wrist' }, body: { ar: 'لكل صورة حدود مرسومة على المعصم، والقطعة مقيّدة بها. لا ينتج العميل صورة سخيفة بالخطأ، ولا يرى وضعًا لا يمكن أن يحدث.', en: 'Each photograph has the wrist mapped, and the piece is constrained to it. A shopper cannot accidentally produce a silly picture, or a placement that could not happen.' } },
      { title: { ar: 'صور حقيقية، لا رسوم', en: 'Real photographs, never drawings' }, body: { ar: 'العارضة والقطعة صور فوتوغرافية. الرسم التوضيحي يبدو رسمًا، ولا يقنع أحدًا بمقاس.', en: 'Both the model and the piece are photographs. An illustration looks like an illustration, and convinces nobody about size.' } },
    ],
    setup: [
      { ar: 'أدخل عرض المنتج وارتفاعه بالمليمتر — بدونهما لا يوجد حجم حقيقي.', en: 'Enter the product’s width and height in millimetres — without them there is no true size.' },
      { ar: 'ارفع صورة للقطعة على خلفية شفافة (PNG) لتظهر على المعصم بحوافها.', en: 'Upload a cut-out of the piece (transparent PNG) so it sits on the wrist with its own edges.' },
      { ar: 'فعّل المنتج من لوحة التحكم — وتظهر التجربة في صفحته فورًا.', en: 'Turn the product on in the dashboard, and try-on appears on its page at once.' },
    ],
    limits: [
      { ar: 'الصور الحالية لمعصم واحد. تعدّد العارضات ودرجات البشرة قادم، وليس متاحًا اليوم.', en: 'Today there is one wrist. More models and more skin tones are coming; they are not here yet.' },
      { ar: 'المعصم في الصورة معصم عارضة، لا معصم عميلك — لذلك توجد «التجربة على صورتك».', en: 'The wrist in the photo is a model’s, not your shopper’s — which is what “on your own photo” is for.' },
      { ar: 'الساعات والأساور أولًا. الخواتم والقلائد والحقائب في الطريق.', en: 'Watches and bracelets first. Rings, necklaces and bags are on the way.' },
    ],
    faq: [
      { q: { ar: 'هل أحتاج إلى تصوير منتجاتي من جديد؟', en: 'Do I need to re-photograph my products?' }, a: { ar: 'لا، إن كانت لديك صورة نظيفة للقطعة. ما نحتاجه هو صورة بخلفية شفافة ومقاس بالمليمتر. وإن لم تتوفر، نجهّزها ضمن خدمة النمذجة.', en: 'No, if you have a clean product shot. What we need is a cut-out with a transparent background and the size in millimetres. If you do not have one, we prepare it as part of the modelling service.' } },
      { q: { ar: 'ماذا لو أدخلت المقاس خطأ؟', en: 'What if I enter the wrong size?' }, a: { ar: 'ستظهر القطعة بحجم خاطئ على المعصم — وهذا أسوأ من عدم عرضها. المقاس يظهر في صفحة المنتج داخل لوحة التحكم لمراجعته قبل التفعيل.', en: 'The piece will appear at the wrong size on the wrist — which is worse than not showing it. The size is shown on the product page in the dashboard so you can check it before you turn it on.' } },
    ],
  },

  'on-me': {
    slug: 'on-me',
    nav: { ar: 'التجربة على صورتك', en: 'On your own photo' },
    icon: 'camera',
    hero: {
      title: { ar: 'على يد عميلك هو، وفي متصفحه وحده', en: 'On your shopper’s own hand, and only in their browser' },
      lead: {
        ar: 'يرفع العميل صورة لظهر يده أو يلتقطها، فيحدّد نموذج رؤية داخل المتصفح موضع المعصم ويضع القطعة بزاويتها. الصورة لا تغادر جهازه.',
        en: 'The shopper uploads or takes a photo of the back of their hand; a vision model inside the browser finds the wrist and places the piece at its angle. The photo never leaves their device.',
      },
    },
    steps: [
      { title: { ar: 'يختار «عليّ»', en: 'Choose “On me”' }, body: { ar: 'يرفع صورة من جهازه، أو يفتح الكاميرا بإذنه، أو ينقل صورة من جواله برمز QR.', en: 'Upload a photo from the device, open the camera with permission, or bring one over from a phone by QR code.' } },
      { title: { ar: 'يُحدَّد المعصم تلقائيًا', en: 'The wrist is found automatically' }, body: { ar: 'يُحمَّل نموذج تحديد اليد إلى المتصفح عند الحاجة فقط، ويقدّر موضع المعصم وزاويته وعرضه من راحة اليد.', en: 'A hand-detection model loads into the browser only when it is needed, and works out where the wrist is, at what angle, and how wide it is from the palm.' } },
      { title: { ar: 'يضبطها بنقرتين إن لزم', en: 'Two taps to correct it' }, body: { ar: 'ينقر على حافتي المعصم، فتُحسب السعة والزاوية من النقرتين مباشرة. لا انزلاقات ولا تخمين.', en: 'Tap the two edges of the wrist and the width and angle come straight from those two points. No sliders, no guessing.' } },
      { title: { ar: 'يحفظ إطلالته', en: 'Save the look' }, body: { ar: 'تُنشأ الصورة على جهازه وتُحفظ فيه. لا نحتفظ بنسخة.', en: 'The image is made on their device and saved there. We keep no copy.' } },
    ],
    how: [
      { title: { ar: 'التحليل على جهاز العميل', en: 'The analysis runs on the shopper’s device' }, body: { ar: 'نموذج تحديد اليد يعمل داخل المتصفح. الصورة المرفوعة لا تُرسل إلى خوادمنا أصلًا، فلا يوجد ما نحتفظ به أو نفقده.', en: 'The hand-detection model runs inside the browser. An uploaded photo is never sent to our servers at all, so there is nothing for us to keep — or to lose.' } },
      { title: { ar: 'لا تعرّف على الوجوه ولا بصمات حيوية', en: 'No facial recognition, no biometric templates' }, body: { ar: 'ما يُحسب هو موضع مفاصل اليد لوضع القطعة، ثم يُنسى. لا نبني قوالب حيوية ولا ندرّب نماذج على صور عملائك.', en: 'What is computed is where the hand’s joints are, so the piece can be placed — then it is forgotten. We build no biometric templates and train no models on your shoppers’ photos.' } },
      { title: { ar: 'لا يُحمَّل شيء قبل الضغط', en: 'Nothing loads before the tap' }, body: { ar: 'الاستوديو ونموذج الرؤية يُحمَّلان حين يضغط العميل الزر، لا مع صفحة المنتج. زمن تحميل صفحتك لا يتغيّر.', en: 'The studio and the vision model load when the shopper presses the button, not with the product page. Your page load time does not change.' } },
    ],
    setup: [
      { ar: 'المقاس بالمليمتر نفسه الذي يخدم العرض على العارضة — لا إعداد إضافي.', en: 'The same millimetre size that serves the model view — nothing extra to set up.' },
      { ar: 'نص موافقة الكاميرا والصور قابل للتحرير من إعدادات متجرك.', en: 'The camera and photo consent wording is editable in your store settings.' },
      { ar: 'صفحة «خصوصية الكاميرا والصور» جاهزة للربط من سياسة متجرك.', en: 'A “Camera & photo privacy” page is ready to link from your own store policy.' },
    ],
    limits: [
      { ar: 'تحتاج إلى صورة واضحة لظهر اليد بإضاءة معقولة. الكُم أو سوار آخر قد يربك التحديد.', en: 'It needs a clear, reasonably lit photo of the back of the hand. A sleeve or another bracelet can confuse the detection.' },
      { ar: 'عرض المعصم تقدير من راحة اليد، لا قياس. لذلك تبقى النقرتان متاحتين دائمًا.', en: 'The wrist width is estimated from the palm, not measured. That is why the two-tap correction is always available.' },
      { ar: 'على صورة العميل اليوم: اليد للساعات والخواتم، والوجه للنظارات والقلائد. الأقراط والحقائب على صورته ضمن خطة التوسّع.', en: 'On the shopper’s own photo today: the hand for watches and rings, the face for glasses and necklaces. Earrings and bags on their photo are in the expansion plan.' },
    ],
    faq: [
      { q: { ar: 'هل تصل صور عملائي إليكم؟', en: 'Do my shoppers’ photos reach you?' }, a: { ar: 'لا. الصورة المرفوعة تبقى في صفحة المتصفح حتى يغلقها العميل. الاستثناء الوحيد هو النقل من الجوال برمز QR، وهو تخزين مؤقت يُحذف فور الاستلام أو بعد 30 دقيقة.', en: 'No. An uploaded photo stays in the browser page until the shopper closes it. The only exception is the QR hand-off from a phone: temporary storage, deleted the moment it is received, or after 30 minutes.' } },
      { q: { ar: 'هل يعمل بدون إنترنت سريع؟', en: 'Does it work without a fast connection?' }, a: { ar: 'نموذج الرؤية يُحمَّل مرة واحدة ثم يبقى في ذاكرة المتصفح المؤقتة. أول فتح هو الأبطأ، وما بعده فوري.', en: 'The vision model downloads once and is then cached by the browser. The first open is the slow one; after that it is immediate.' } },
    ],
  },

  'true-size': {
    slug: 'true-size',
    nav: { ar: 'المقارنة بالحجم الحقيقي', en: 'True-size comparison' },
    icon: 'ruler',
    hero: {
      title: { ar: '«أكبر قليلًا من ريال» يفهمها العميل فورًا', en: '“A little bigger than a riyal” lands at once' },
      lead: {
        ar: '«29 مم» رقم يصعب تخيّله. نضع القطعة بجانب ريال سعودي وإيربودز وآيفون، كلها بالمقياس نفسه، فيصبح المقاس شيئًا يُرى لا يُحسب.',
        en: '“29 mm” is a number that is hard to picture. We put the piece beside a Saudi riyal, AirPods and an iPhone, all at one scale, so size becomes something you see rather than something you work out.',
      },
    },
    steps: [
      { title: { ar: 'يختار مرجعًا يعرفه', en: 'Pick something familiar' }, body: { ar: 'ريال سعودي، أو علبة إيربودز، أو آيفون — أشياء يحملها كل يوم ويعرف حجمها بيده.', en: 'A Saudi riyal, an AirPods case, an iPhone — things they carry daily and know the size of by hand.' } },
      { title: { ar: 'يحرّكهما ويدوّرهما', en: 'Move and rotate either one' }, body: { ar: 'يسحب أيًا منهما ويدوّره ليقارن من الزاوية التي يريدها. التكبير يغيّر حجم العنصرين معًا، فتبقى النسبة صحيحة.', en: 'Drag or rotate either item to compare from the angle they want. Zoom scales both together, so the ratio stays honest.' } },
      { title: { ar: 'يقرأ القياس', en: 'Read the measurement' }, body: { ar: 'خطوط قياس على القطعة، وشبكة خلفية كل مربع فيها 10 مم، والوحدة بالمليمتر أو البوصة.', en: 'Measurement lines on the piece, a background grid of 10 mm squares, and a choice of millimetres or inches.' } },
    ],
    how: [
      { title: { ar: 'مقياس واحد للجميع', en: 'One scale for everything' }, body: { ar: 'المراجع مقاسة بأبعادها الحقيقية، والقطعة بمقاسك المُدخَل، والاثنان يُرسمان بالمقياس نفسه. المقارنة بينهما دقيقة تمامًا.', en: 'The references carry their real dimensions, the piece carries the size you entered, and both are drawn at the same scale. The comparison between them is exact.' } },
      { title: { ar: 'ما لا ندّعيه', en: 'What we do not claim' }, body: { ar: 'الشاشات تختلف، فلا نزعم أن القطعة تظهر بحجمها الفعلي على شاشة عميلك. ما نضمنه هو النسبة إلى المرجع — وهي ما يحتاجه ليقرر.', en: 'Screens differ, so we do not claim the piece appears at its physical size on your shopper’s screen. What we guarantee is the ratio to the reference — which is what they need in order to decide.' } },
      { title: { ar: 'مراجع حقيقية', en: 'Real reference objects' }, body: { ar: 'صور فوتوغرافية لأشياء حقيقية بأبعادها المنشورة، لا رسوم تقريبية.', en: 'Photographs of real objects at their published dimensions, not approximate drawings.' } },
    ],
    setup: [
      { ar: 'العرض والارتفاع بالمليمتر — وهما كل ما تحتاجه هذه الطريقة.', en: 'Width and height in millimetres — all this mode needs.' },
      { ar: 'الوحدة الافتراضية (مم أو بوصة) قابلة للضبط لكل متجر.', en: 'The default unit (mm or inches) is set per store.' },
    ],
    limits: [
      { ar: 'المقارنة بالمساحة والحدود الخارجية، لا بالسماكة ولا بالوزن.', en: 'It compares outline and footprint — not thickness, and not weight.' },
      { ar: 'ثلاثة مراجع اليوم. إضافة مراجع محلية أخرى مسألة صور ومقاسات، لا برمجة.', en: 'Three references today. Adding other locally familiar ones is a matter of photos and dimensions, not code.' },
    ],
    faq: [
      { q: { ar: 'لماذا لا تعرضون المقاس الحقيقي على الشاشة مباشرة؟', en: 'Why not show it at life size on screen?' }, a: { ar: 'لأن ذلك يتطلب معرفة كثافة بكسلات شاشة كل عميل، وهي معلومة لا يوفّرها المتصفح بدقة. المقارنة بشيء معروف تعطي الجواب نفسه دون ادّعاء لا يصح.', en: 'Because that needs the pixel density of every shopper’s screen, which the browser does not report reliably. Comparing with something familiar gives the same answer without a claim we cannot stand behind.' } },
      { q: { ar: 'هل تصلح لغير الساعات؟', en: 'Does it work for things other than watches?' }, a: { ar: 'نعم — أي منتج صغير له مقاس بالمليمتر: أساور، خواتم، نظارات، عطور. تحتاج فقط إلى صورة بخلفية شفافة ومقاس صحيح.', en: 'Yes — any small product with a size in millimetres: bracelets, rings, eyewear, fragrance bottles. All it needs is a cut-out and a correct size.' } },
    ],
  },

  'phone-handoff': {
    slug: 'phone-handoff',
    nav: { ar: 'من الحاسوب إلى الجوال', en: 'Desktop to phone' },
    icon: 'qr',
    hero: {
      title: { ar: 'يتصفح على الحاسوب، ويصوّر بجواله', en: 'Browsing on a computer, shooting with a phone' },
      lead: {
        ar: 'كاميرا الحاسوب رديئة وزاويتها خاطئة. يمسح العميل رمز QR، يلتقط صورة يده بجواله، فتظهر النتيجة على الشاشة الكبيرة خلال ثوانٍ.',
        en: 'A laptop camera is poor and points the wrong way. The shopper scans a QR code, takes the photo of their hand with their phone, and the result appears on the big screen within seconds.',
      },
    },
    steps: [
      { title: { ar: 'يظهر الرمز في الاستوديو', en: 'The code appears in the studio' }, body: { ar: 'ضغطة واحدة داخل وضع «عليّ» على الحاسوب.', en: 'One tap inside “On me” on the computer.' } },
      { title: { ar: 'يمسحه بكاميرا جواله', en: 'Scan it with the phone camera' }, body: { ar: 'تُفتح صفحة التقاط بسيطة على الجوال. لا تطبيق، ولا تسجيل دخول، ولا حساب.', en: 'A simple capture page opens on the phone. No app, no sign-in, no account.' } },
      { title: { ar: 'يلتقط الصورة', en: 'Take the photo' }, body: { ar: 'بالكاميرا الخلفية وبزاوية مريحة — وهي الصورة التي يصعب التقاطها أمام الحاسوب.', en: 'With the rear camera, at a comfortable angle — the shot that is awkward to take at a laptop.' } },
      { title: { ar: 'تظهر على الحاسوب', en: 'It lands on the computer' }, body: { ar: 'خلال ثوانٍ، ويكمل التجربة على الشاشة الكبيرة.', en: 'Within seconds, and the try-on continues on the big screen.' } },
    ],
    how: [
      { title: { ar: 'رمز جلسة عشوائي بطول 128 بت', en: 'A random 128-bit session code' }, body: { ar: 'لا يمكن تخمينه، ولا يفتح شيئًا غير هذه الجلسة الواحدة.', en: 'It cannot be guessed, and it opens nothing but that one session.' } },
      { title: { ar: 'تخزين مؤقت يُحذف فور الاستلام', en: 'Temporary storage, deleted on arrival' }, body: { ar: 'تُضغط الصورة وتُرفع إلى مساحة لا يصلها إلا حامل الرمز، ويستلمها الحاسوب ثم تُحذف. وإن لم تُستلم، تنتهي الجلسة وتُحذف بعد 30 دقيقة.', en: 'The photo is compressed and uploaded to space reachable only with that code; the computer receives it and it is deleted. If it is never received, the session expires and it is deleted after 30 minutes.' } },
      { title: { ar: 'لا حاجة لشبكة مشتركة', en: 'No shared network needed' }, body: { ar: 'الجوال والحاسوب لا يحتاجان إلى الشبكة نفسها — كل ما يلزم هو اتصال بالإنترنت على الجهازين.', en: 'The phone and the computer do not need to be on the same network — each just needs to be online.' } },
    ],
    setup: [
      { ar: 'لا إعداد. تعمل حيثما عملت التجربة على الصورة.', en: 'Nothing to set up. It works wherever the photo try-on works.' },
    ],
    limits: [
      { ar: 'تحتاج إلى متصفح بكاميرا على الجوال، وإلى اتصال على الجهازين.', en: 'It needs a phone browser with a camera, and both devices online.' },
      { ar: 'الرمز صالح 30 دقيقة ثم ينتهي؛ بعدها يبدأ العميل جلسة جديدة.', en: 'The code lasts 30 minutes and then expires; after that the shopper starts a new session.' },
    ],
    faq: [
      { q: { ar: 'هل يحتاج عميلي إلى تطبيق؟', en: 'Does my shopper need an app?' }, a: { ar: 'لا. صفحة ويب تُفتح من كاميرا الجوال، لا أكثر.', en: 'No. A web page opened from the phone camera, nothing more.' } },
      { q: { ar: 'ماذا لو أغلق الصفحة قبل أن تصل الصورة؟', en: 'What if they close the page before the photo arrives?' }, a: { ar: 'تنتهي الجلسة وتُحذف الصورة بعد 30 دقيقة دون أن يراها أحد.', en: 'The session expires and the photo is deleted after 30 minutes, seen by nobody.' } },
    ],
  },
};

export const FEATURE_ORDER: FeatureSlug[] = ['on-model', 'on-me', 'true-size', 'phone-handoff'];

export const featurePage = (slug: string): FeaturePage | undefined =>
  (FEATURE_PAGES as Record<string, FeaturePage>)[slug];
