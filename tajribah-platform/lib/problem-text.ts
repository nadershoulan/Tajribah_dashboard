/**
 * The server's refusals in the reader's language. The server writes each one in English (its logs and
 * the API's own documents read it); the dashboard shows it in Arabic when the dashboard is in Arabic.
 * A line known here is said in full; one that is not (a staff-only or rare one) falls back to the Arabic
 * title of its kind — "not permitted", "not found", "plan limit reached" — never to English.
 * One copy for every screen: `ErrorNote` uses it, and so can any screen that shows a refusal itself.
 */
import { CUTOUT_ISSUES } from './tryon';
import type { Lang } from './lang';

/** Each problem code's Arabic title (the server's `problem.ts` gives the same, for the API's documents). */
export const PROBLEM_TITLE_AR: Record<string, string> = {
  validation_failed: 'بيانات غير صالحة',
  invalid_credentials: 'بيانات الدخول غير صحيحة',
  unauthenticated: 'يلزم تسجيل الدخول',
  forbidden: 'لا تملك صلاحية لهذا',
  not_found: 'غير موجود',
  conflict: 'لا يمكن تنفيذ هذا الآن',
  idempotency_conflict: 'طلب مكرر بمحتوى مختلف',
  rate_limited: 'محاولات كثيرة — انتظر قليلًا ثم حاول مرة أخرى',
  quota_exceeded: 'تجاوزت حد الباقة',
  plan_required: 'يتطلب ترقية الباقة',
  store_read_only: 'المتجر للقراءة فقط',
  upstream_unavailable: 'خدمة خارجية غير متاحة الآن',
  upstream_timeout: 'انتهت مهلة الخدمة الخارجية',
  ai_paused: 'أعمال الذكاء الاصطناعي متوقفة مؤقتًا',
  not_implemented: 'غير متاح بعد',
  internal: 'حدث خطأ غير متوقع — حاول مرة أخرى',
};

/** What `errors.notFound(what)` names. */
const THING_AR: Record<string, string> = {
  product: 'المنتج', picture: 'الصورة', photo: 'الصورة', upload: 'الملف المرفوع', model: 'النموذج',
  'model file': 'ملف النموذج', 'model version': 'نسخة النموذج', 'store connection': 'ربط المتجر', sync: 'المزامنة',
  'team member': 'عضو الفريق', invitation: 'الدعوة', invoice: 'الفاتورة', order: 'الطلب', ai_job: 'المهمة',
  'custom role': 'الدور', resource: 'العنصر', store: 'المتجر', category: 'التصنيف',
};

const TRYON_MISSING_AR: Record<string, string> = {
  'its try-on picture': 'صورة التجربة', 'the product shot': 'صورة المنتج', 'its width': 'المقاس',
  worn: 'صورة التجربة', flat: 'صورة المنتج', case: 'المقاس',
};

/** English line (or its start) → Arabic. Order matters only where one pattern contains another. */
const LINES: [RegExp, string | ((m: RegExpMatchArray) => string)][] = [
  // permissions, plans, the store's state
  [/^missing permission: /, 'دورك في الفريق لا يسمح بهذا.'],
  [/^plan limit reached for (.+) \((\d+)\)$/, (m) => `بلغت حد باقتك (${m[2]}). رقِّ باقتك للمزيد.`],
  [/is not included in this plan$/, 'هذه الميزة ليست ضمن باقتك. رقِّ باقتك لاستخدامها.'],
  [/^the free trial has ended/, 'انتهت الفترة التجريبية — اختر باقة لتتمكن من التعديل.'],
  [/^the subscription has ended/, 'انتهى الاشتراك — اختر باقة لتتمكن من التعديل.'],
  [/^your plan does not include product pages/, 'باقتك لا تشمل صفحات المنتجات.'],
  [/^not enough AI credits: (\d+) left, (\d+) needed/, (m) => `رصيدك لا يكفي: بقي ${m[1]} ويلزم ${m[2]}.`],
  [/is unavailable$/, 'خدمة خارجية غير متاحة الآن — حاول بعد قليل.'],
  [/^(.+) not found$/, (m) => `${THING_AR[m[1]!] ?? 'العنصر'} غير موجود.`],

  // try-on
  [/^finish the try-on first: add (.+)$/, (m) => `أكمل التجربة أولًا: أضف ${m[1]!.split(' and ').map((x) => TRYON_MISSING_AR[x] ?? x).join(' و')}.`],
  [/^try-on cannot be switched on yet — missing: (.+)$/, (m) => `لا يمكن تفعيل التجربة بعد — ينقصها: ${m[1]!.split(/,\s*/).map((x) => TRYON_MISSING_AR[x.trim()] ?? x).join('، ')}.`],
  [/^mark this jewelry as a ring, a necklace or an earring first/, 'حدّد أولًا هل هذه القطعة خاتم أم قلادة أم قرط.'],
  [/^only a Jewelry product can be marked/, 'لا يُحدَّد خاتمًا أو قلادة أو قرطًا إلا منتج من نوع «مجوهرات».'],
  [/^try-on is for watches, glasses, jewelry and bags/, 'التجربة للساعات والنظارات والمجوهرات والحقائب — اجعل نوع المنتج أحدها أولًا.'],
  [/^this product’s type is not tried on/, 'نوع هذا المنتج لا يُجرَّب — اجعله ساعة أو نظارات أو مجوهرات أو حقيبة أولًا.'],
  [/^the picture has changed since you marked it/, 'تغيّرت الصورة منذ حدّدت حوافها — حدّدها مرة أخرى.'],
  [/^the picture has not arrived yet/, 'لم تصل الصورة بعد — ارفعها ثم أكّد.'],
  [/^the photo has not arrived yet/, 'لم تصل الصورة بعد — ارفعها ثم أكّد.'],
  [/^the file has not arrived yet/, 'لم يصل الملف بعد — ارفعه ثم أكّد.'],
  [/^the uploaded file is no longer in storage/, 'الملف المرفوع لم يعد محفوظًا — ارفعه مرة أخرى.'],
  [/^remove the picture first/, 'احذف الصورة أولًا.'],
  [/^not one of this product’s pictures from its store/, 'هذه ليست من صور المنتج في متجرك.'],
  [/^this picture is a JPEG/, 'هذه الصورة JPEG بلا خلفية شفافة — استخدم «أزل الخلفية واحفظها» أو ارفع صورة مقصوصة.'],
  [/^the picture is larger than 10 MB/, 'الصورة أكبر من 10 ميجابايت.'],
  [/^the store answered (\d+) for this picture/, (m) => `ردّ المتجر بالرمز ${m[1]} على هذه الصورة — تأكد أن الصورة ما زالت موجودة.`],
  [/^the store’s picture did not answer/, 'لم تُجب صورة المتجر — حاول بعد قليل.'],
  [/^the picture’s address/, 'عنوان الصورة غير صالح أو يشير إلى شبكة خاصة.'],
  [/^this is not a PNG, WebP or JPEG picture|^this is not a PNG or WebP picture/, 'هذا ليس ملف صورة مقبولًا (PNG أو WebP أو JPEG).'],

  // publishing
  [/^cannot publish: nothing for the button to open/, 'لا يوجد ما يفتحه الزر بعد — اضبط تجربة المنتج أولًا (صورته ومقاسه).'],
  [/^cannot publish: this product is archived or deleted/, 'هذا المنتج مؤرشف أو محذوف.'],
  [/^cannot publish: this store is suspended or closed/, 'هذا المتجر موقوف أو مغلق.'],
  [/^cannot publish: the settings do not make a valid config/, 'الإعدادات لا تكوّن عرضًا صالحًا — تواصل مع الدعم.'],
  [/^this product is not published/, 'هذا المنتج غير منشور.'],

  // products, feeds, stores
  [/^these products came from a file/, 'هذه المنتجات من ملف — ارفع الملف مرة أخرى لتحديثها.'],
  [/^the last file is still being imported/, 'ما زال آخر ملف قيد الاستيراد — حاول بعد دقيقة.'],
  [/^disconnect the store first, then remove it/, 'افصل المتجر أولًا ثم احذفه.'],
  [/^this store is already connected to another Tajribah account/, 'هذا المتجر مربوط بحساب آخر في تجربة.'],
  [/^this (Salla|Zid) store is already linked/, 'هذا المتجر مربوط بالفعل.'],
  [/stores can be (linked|connected) once the Tajribah .+ app is registered$/, 'ربط المتجر المباشر يأتي في الإصدار الثاني — أضف منتجاتك اليوم من رابط ملف المنتجات أو ملف.'],
  [/^the product has no measurements to fit to/, 'لا مقاسات لهذا المنتج — أضف عرضه وارتفاعه أولًا.'],
  [/^this product already has an open request/, 'لهذا المنتج طلب مفتوح بالفعل.'],
  [/^only a quote not yet accepted can be accepted/, 'لا يُقبل إلا عرض سعر لم يُقبل بعد.'],
  [/^this order can no longer be cancelled/, 'لم يعد ممكنًا إلغاء هذا الطلب.'],

  // a feed link and its readings (shown on Store connections as the last error)
  [/^sync failed: (.+)$/, (m) => `فشلت المزامنة: ${arabicOf(m[1]!) ?? 'حاول مرة أخرى بعد قليل.'}`],
  [/^the store listed (\d+) of (\d+) products — nothing archived/, (m) => `أعطى المتجر ${m[1]} من ${m[2]} منتجًا — لم نؤرشف شيئًا. راجع المتجر ثم زامن مرة أخرى.`],
  [/^the feed answered (\d+)/, (m) => `ردّ رابط ملف المنتجات بالرمز ${m[1]} — تأكد أن الرابط صحيح وما زال يعمل.`],
  [/^the feed did not answer/, 'لم يُجب رابط ملف المنتجات — حاول بعد قليل.'],
  [/^the feed is larger than 30 MB/, 'ملف المنتجات أكبر من 30 ميجابايت.'],
  [/^the feed redirected too many times/, 'رابط ملف المنتجات يحوّل مرات كثيرة.'],
  [/^the feed redirected somewhere we will not follow/, 'رابط ملف المنتجات يحوّل إلى عنوان لا نفتحه.'],
  [/^the feed’s address does not exist/, 'عنوان رابط ملف المنتجات غير موجود.'],
  [/^the feed’s address points to a private network/, 'رابط ملف المنتجات يشير إلى شبكة خاصة، ولا نفتحه.'],
  [/^we could not look up the feed’s address/, 'تعذّر الوصول إلى عنوان رابط ملف المنتجات — حاول بعد قليل.'],
  [/^this feed connection has no link/, 'لا رابط لهذا الربط — أضف رابط ملف المنتجات من جديد.'],
  [/^a file is read when it is uploaded/, 'الملف يُقرأ عند رفعه — ارفعه مرة أخرى لتحديث المنتجات.'],

  // linking Salla and Zid directly (version 2, still in the code)
  [/^Salla did not confirm this session/, 'لم تؤكد سلة هذه الجلسة — افتح تجربة من جديد من لوحة سلة.'],
  [/did not come from your Salla dashboard/, 'انتهت صلاحية هذا الرابط أو لم يأتِ من لوحة سلة — افتح تجربة من جديد من سلة.'],
  [/did not come from Zid/, 'انتهت صلاحية هذا الرابط أو لم يأتِ من زد — اربط من جديد من زد أو من «ربط المتجر».'],
  [/^(Salla|Zid) no longer accepts this store’s access/, 'لم تعد المنصة تقبل صلاحية هذا المتجر — اربطه من جديد.'],
  [/^this store’s access could not be read/, 'تعذّرت قراءة صلاحية هذا المتجر — اربطه من جديد.'],
  [/access is for a different store than this link$/, 'الصلاحية لمتجر غير المتجر في هذا الرابط.'],
  [/^this approval did not come from a connection/, 'هذه الموافقة لم تبدأ من هنا أو انتهت صلاحيتها — ابدأ من جديد من «ربط المتجر».'],
  [/has not handed over this store’s access yet/, 'لم تسلّم المنصة صلاحية هذا المتجر بعد — انتظر دقيقة ثم حاول مرة أخرى.'],

  // 3D models (version 2, still in the code)
  [/^this is the live version/, 'هذه هي النسخة المنشورة — انشر نسخة أخرى أولًا، أو احذف النموذج كله.'],
  [/^this version is still being prepared/, 'ما زالت هذه النسخة قيد التجهيز — احذفها حين تجهز أو تفشل.'],
  [/^this version has no GLB to edit/, 'لا ملف GLB في هذه النسخة لتعديله.'],
  [/^version \d+ is \w+ — only a ready version/, 'لا يُستخدم إلا نسخة جاهزة.'],

  // team and account
  [/^this person is already on the team/, 'هذا الشخص في الفريق بالفعل.'],
  [/^the owner cannot be removed/, 'لا يمكن حذف مالك المتجر.'],
  [/^the owner’s role cannot be changed here/, 'لا يتغيّر دور المالك من هنا.'],
  [/^you cannot change your own role/, 'لا يمكنك تغيير دورك بنفسك.'],
  [/^you cannot give a role above your own/, 'لا يمكنك منح دور أعلى من دورك.'],
  [/^you cannot remove yourself/, 'لا يمكنك حذف نفسك.'],
  [/^a store keeps at most (\d+) custom roles/, (m) => `للمتجر ${m[1]} أدوار مخصصة على الأكثر.`],
  [/^this email already has an account/, 'لهذا البريد حساب بالفعل — سجّل الدخول.'],
  [/^confirm your email address before adding another store/, 'أكّد بريدك الإلكتروني قبل إضافة متجر آخر.'],
  [/^the sign-in step expired/, 'انتهت مهلة خطوة الدخول — أدخل كلمة المرور مرة أخرى.'],
  [/^two-step sign-in is already on/, 'التحقق بخطوتين مفعّل بالفعل.'],
  [/^two-step sign-in is already off|^two-step sign-in is off/, 'التحقق بخطوتين غير مفعّل.'],
  [/^start the setup first/, 'ابدأ الإعداد أولًا.'],
  [/^a staff view cannot add stores/, 'عرض الموظفين لا يضيف متاجر.'],
];

/** The cut-out refusals already have their Arabic beside them (`lib/tryon.ts`). */
for (const text of Object.values(CUTOUT_ISSUES)) LINES.push([new RegExp(`^${text.en.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`), text.ar]);

/** One English line in Arabic, or null when it is not one of ours. */
export function arabicOf(line: string): string | null {
  for (const [pattern, ar] of LINES) {
    const m = line.match(pattern);
    if (m) return typeof ar === 'string' ? ar : ar(m);
  }
  return null;
}

const ARABIC = /[؀-ۿ]/;

/**
 * What to tell the reader about a failed request. English: the server's own line. Arabic: the line in
 * Arabic, or each field's refusal in Arabic, or the Arabic title of its kind — never English.
 */
export function sayProblem(error: unknown, lang: Lang): string {
  const e = error as { code?: string; detail?: string; message?: string; fields?: Record<string, string[]> } | null;
  const detail = e?.detail || e?.message || '';
  if (lang === 'en') return detail || 'Something went wrong';
  if (ARABIC.test(detail)) return detail; // already the reader's language (a screen's own words)
  const known = detail ? arabicOf(detail) : null;
  if (known) return known;
  const fields = Object.values(e?.fields ?? {}).flat();
  const saidFields = fields.map((f) => (ARABIC.test(f) ? f : arabicOf(f))).filter((f): f is string => !!f);
  if (saidFields.length) return [...new Set(saidFields)].join(' ');
  return PROBLEM_TITLE_AR[e?.code ?? ''] ?? 'حدث خطأ — حاول مرة أخرى.';
}
