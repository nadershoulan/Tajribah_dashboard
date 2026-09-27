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

export type AiJobErrorCode = 'insufficient_credits' | 'not_available' | 'bad_input' | 'provider_failed' | 'timed_out';

export const AI_JOB_ERRORS: Record<AiJobErrorCode, Bi> = {
  insufficient_credits: { ar: 'رصيد الذكاء الاصطناعي لا يكفي لهذه المهمة.', en: 'Not enough AI credits for this job.' },
  not_available: { ar: 'هذه الخدمة غير متاحة بعد. أُعيد إليك رصيدك.', en: 'This service is not available yet. Your credits were returned.' },
  bad_input: { ar: 'تعذّر استخدام الصور المرفوعة. جرّب صورًا أوضح. أُعيد إليك رصيدك.', en: 'The uploaded photos could not be used. Try clearer ones. Your credits were returned.' },
  provider_failed: { ar: 'تعذّر إكمال المهمة. أُعيد إليك رصيدك.', en: 'The job could not be completed. Your credits were returned.' },
  timed_out: { ar: 'استغرقت المهمة وقتًا أطول من المسموح فأُوقفت. أُعيد إليك رصيدك.', en: 'The job took too long and was stopped. Your credits were returned.' },
};
