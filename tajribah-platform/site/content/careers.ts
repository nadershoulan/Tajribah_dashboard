import type { Bi } from '@site/lib/lang';

/**
 * Careers (Track M, M10). How Tajribah works and the roles it expects to hire for as it grows.
 * These are described as roles we expect to open, not advertised vacancies: an applicant must
 * never be invited to apply for a job that does not exist. Interest goes to the company email.
 */
export const HOW_WE_WORK: { title: Bi; body: Bi }[] = [
  { title: { ar: 'العربية أولًا، دائمًا', en: 'Arabic first, always' }, body: { ar: 'نصمم لعميل يقرأ من اليمين إلى اليسار، ونراجع كل شاشة بالاتجاهين قبل نشرها.', en: 'We design for a shopper who reads right to left, and check every screen in both directions before it ships.' } },
  { title: { ar: 'صور حقيقية فقط', en: 'Real photos only' }, body: { ar: 'التجربة تعمل على صور حقيقية لقطع حقيقية. لا نرسم بديلًا لمنتج أو يد.', en: 'Try-on runs on real photos of real pieces. We never draw a stand-in for a product or a hand.' } },
  { title: { ar: 'الخصوصية في التصميم', en: 'Privacy by design' }, body: { ar: 'ما لا نحتاجه لا نجمعه. تحليل الصور يحدث على جهاز العميل.', en: 'What we do not need, we do not collect. Photo analysis happens on the shopper’s device.' } },
  { title: { ar: 'نقيس بصدق', en: 'We measure honestly' }, body: { ar: 'لا ننشر رقمًا لا نستطيع إثباته، لا لعملائنا ولا لأنفسنا.', en: 'We publish no number we cannot stand behind — to our customers or to ourselves.' } },
];

export type Role = { title: Bi; team: Bi; place: Bi; about: Bi; you: Bi[] };

export const EXPECTED_ROLES: Role[] = [
  {
    title: { ar: 'مهندس/ة واجهات أمامية', en: 'Front-end engineer' },
    team: { ar: 'المنتج', en: 'Product' }, place: { ar: 'الرياض أو عن بُعد داخل المملكة', en: 'Riyadh or remote within Saudi Arabia' },
    about: { ar: 'تبني لوحة التاجر والاستوديو الذي يراه العميل، بالعربية والإنجليزية، على الجوال أولًا.', en: 'Build the merchant dashboard and the studio shoppers see, in Arabic and English, mobile first.' },
    you: [{ ar: 'خبرة في React وTypeScript', en: 'Experience with React and TypeScript' }, { ar: 'حسّ عالٍ بالتصميم من اليمين إلى اليسار', en: 'A keen eye for right-to-left design' }],
  },
  {
    title: { ar: 'مهندس/ة رؤية حاسوبية', en: 'Computer-vision engineer' },
    team: { ar: 'التجربة الافتراضية', en: 'Try-on' }, place: { ar: 'الرياض أو عن بُعد', en: 'Riyadh or remote' },
    about: { ar: 'تحسّن تحديد المعصم واليد والوجه داخل المتصفح، بسرعة تعمل على جوال متوسط.', en: 'Improve in-browser wrist, hand and face tracking, fast enough for a mid-range phone.' },
    you: [{ ar: 'خبرة في نماذج الرؤية على الجهاز', en: 'Experience with on-device vision models' }, { ar: 'اهتمام بالدقة بالمليمتر', en: 'Care for millimetre accuracy' }],
  },
  {
    title: { ar: 'مسؤول/ة نجاح التجّار', en: 'Merchant success lead' },
    team: { ar: 'العملاء', en: 'Customers' }, place: { ar: 'الرياض', en: 'Riyadh' },
    about: { ar: 'ترافق المتاجر الأولى من التركيب إلى أول نتيجة يمكن قياسها، وتنقل ملاحظاتهم إلى فريق المنتج.', en: 'Take the first stores from installation to their first measurable result, and bring their feedback to the product team.' },
    you: [{ ar: 'معرفة بمنصات سلة وزد', en: 'Knowledge of Salla and Zid' }, { ar: 'عربية وإنجليزية ممتازتان', en: 'Excellent Arabic and English' }],
  },
];
