/**
 * P3.2 — what a merchant is told about an AI job, in both languages. The server stores a code;
 * the provider's own error text stays in `ai_jobs.error_message` for staff and never reaches
 * this list.
 */
import type { Bi } from './lang';

export const AI_JOB_STAGES = ['preparing', 'generating', 'post_processing', 'checking'] as const;
export type AiJobStage = (typeof AI_JOB_STAGES)[number];

export const AI_JOB_STAGE_LABELS: Record<AiJobStage, Bi> = {
  preparing: { ar: 'تجهيز الصور', en: 'Preparing the photos' },
  generating: { ar: 'إنشاء النموذج', en: 'Generating the model' },
  post_processing: { ar: 'تحسين النموذج', en: 'Optimising the model' },
  checking: { ar: 'فحص الجودة', en: 'Checking quality' },
};

/** P6.8 — what each kind of AI work is called on the merchant's screens. */
export const AI_JOB_TYPE_LABELS: Record<'generate_3d' | 'enhance_texture' | 'embed_product' | 'enrich_content' | 'quality_check' | 'convert_format', Bi> = {
  generate_3d: { ar: 'توليد نموذج ثلاثي الأبعاد', en: '3D model from photos' },
  enhance_texture: { ar: 'تحسين الخامات', en: 'Texture enhancement' },
  embed_product: { ar: 'تجهيز المقارنة والتوصيات', en: 'Preparing comparison and recommendations' },
  enrich_content: { ar: 'إثراء الوصف بالعربية', en: 'Arabic description enrichment' },
  quality_check: { ar: 'فحص الجودة', en: 'Quality check' },
  convert_format: { ar: 'تحويل الصيغة', en: 'Format conversion' },
};

export type AiJobErrorCode = 'insufficient_credits' | 'not_available' | 'bad_input' | 'provider_failed' | 'timed_out';

export const AI_JOB_ERRORS: Record<AiJobErrorCode, Bi> = {
  insufficient_credits: { ar: 'رصيد الذكاء الاصطناعي لا يكفي لهذه المهمة.', en: 'Not enough AI credits for this job.' },
  not_available: { ar: 'هذه الخدمة غير متاحة بعد. أُعيد إليك رصيدك.', en: 'This service is not available yet. Your credits were returned.' },
  bad_input: { ar: 'تعذّر استخدام الصور المرفوعة. جرّب صورًا أوضح. أُعيد إليك رصيدك.', en: 'The uploaded photos could not be used. Try clearer ones. Your credits were returned.' },
  provider_failed: { ar: 'تعذّر إكمال المهمة. أُعيد إليك رصيدك.', en: 'The job could not be completed. Your credits were returned.' },
  timed_out: { ar: 'استغرقت المهمة وقتًا أطول من المسموح فأُوقفت. أُعيد إليك رصيدك.', en: 'The job took too long and was stopped. Your credits were returned.' },
};

/** P3.3 — why a product photo was refused (or, for `low_resolution`, accepted with a lower score). */
export type PhotoIssueCode = 'unsupported_format' | 'unreadable' | 'too_small' | 'too_large_file' | 'extreme_aspect' | 'duplicate' | 'low_resolution';

export const PHOTO_ISSUES: Record<PhotoIssueCode, Bi> = {
  unsupported_format: { ar: 'الصيغة غير مدعومة. استخدم JPG أو PNG أو WebP (صور HEIC من الآيفون: اختر «الأكثر توافقًا» في إعدادات الكاميرا).', en: 'Unsupported format. Use JPG, PNG or WebP (for iPhone HEIC photos, choose "Most Compatible" in camera settings).' },
  unreadable: { ar: 'تعذّرت قراءة الصورة. قد يكون الملف تالفًا.', en: 'The image could not be read. The file may be damaged.' },
  too_small: { ar: 'الصورة صغيرة جدًا: يجب ألا يقل الضلع الأقصر عن 768 بكسل.', en: 'The photo is too small: the short side must be at least 768 pixels.' },
  too_large_file: { ar: 'الملف أكبر من 20 ميجابايت.', en: 'The file is larger than 20 MB.' },
  extreme_aspect: { ar: 'الصورة طويلة أو عريضة أكثر من اللازم. صوّر المنتج في إطار أقرب إلى المربع.', en: 'The photo is too long or too wide. Frame the product closer to a square.' },
  duplicate: { ar: 'هذه الصورة مرفوعة من قبل لهذا المنتج.', en: 'This photo has already been uploaded for this product.' },
  low_resolution: { ar: 'مقبولة، لكن صورة بدقة أعلى (1500 بكسل أو أكثر للضلع الأقصر) تعطي نموذجًا أدق.', en: 'Accepted, but a sharper photo (1500 pixels or more on the short side) gives a more detailed model.' },
};

/** Issues that refuse a photo; `low_resolution` alone accepts it with a lower score. */
export const BLOCKING_PHOTO_ISSUES: readonly PhotoIssueCode[] = ['unsupported_format', 'unreadable', 'too_small', 'too_large_file', 'extreme_aspect', 'duplicate'];

/** A stored list of issue codes, as the merchant sees them. Server and preview share it. */
export function photoIssueViews(codes: readonly string[]): { code: string; blocking: boolean; message: Bi }[] {
  return codes.map((code) => ({
    code,
    blocking: (BLOCKING_PHOTO_ISSUES as readonly string[]).includes(code),
    message: PHOTO_ISSUES[code as PhotoIssueCode] ?? PHOTO_ISSUES.unreadable,
  }));
}

export const GENERATION_ANGLES = ['front', 'side', 'back', 'detail'] as const;
export type GenerationAngle = (typeof GENERATION_ANGLES)[number];

/** How many photos each angle holds. Details can show a clasp, an engraving, a texture. */
export const ANGLE_SLOTS: Record<GenerationAngle, number> = { front: 1, side: 1, back: 1, detail: 3 };

export const ANGLE_LABELS: Record<GenerationAngle, Bi> = {
  front: { ar: 'الأمام', en: 'Front' },
  side: { ar: 'الجانب', en: 'Side' },
  back: { ar: 'الخلف', en: 'Back' },
  detail: { ar: 'تفاصيل', en: 'Detail' },
};
