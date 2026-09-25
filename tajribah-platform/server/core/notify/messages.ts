/**
 * P0.9 — every message the platform sends, in both languages, in one file.
 *
 * SMS templates are length-checked **when this module loads**: `smsTemplate` renders its
 * worst-case sample in Arabic and English and throws if either would cost a second part.
 * A too-long Arabic OTP therefore stops the server booting and fails the test suite; it
 * never reaches a merchant as a three-part message (§11 — Arabic is 70 characters per part).
 *
 * Email always has a plain-text body. HTML is optional and not used yet: a text-only mail
 * cannot render left-to-right by accident, and a mail with no text part lands in spam.
 */
import { pick, type Bi, type Lang } from '@/lib/lang';
import { assertSmsLength, emailSender, smsSender } from './notify';

const BRAND: Bi = { ar: 'تجربة', en: 'Tajribah' };

// ------------------------------------------------------------------------------ SMS

export type SmsTemplate<P> = {
  name: string;
  /** The longest values the template will ever be rendered with. It is checked against these. */
  sample: P;
  render: (params: P, lang: Lang) => string;
};

/** Define an SMS template. Throws now, not at send time, if either language exceeds `maxParts`. */
export function smsTemplate<P>(name: string, sample: P, text: (params: P) => Bi, maxParts = 1): SmsTemplate<P> {
  for (const lang of ['ar', 'en'] as const) {
    try {
      assertSmsLength(pick(text(sample), lang), maxParts);
    } catch (error) {
      throw new Error(`SMS template "${name}" (${lang}) is too long. ${(error as Error).message}`);
    }
  }
  return { name, sample, render: (params, lang) => pick(text(params), lang) };
}

export const SMS = {
  /** Phone verification and sign-in. The code is six digits (`otpCode`). */
  otp: smsTemplate('otp', { code: '000000', minutes: 60 }, ({ code, minutes }) => ({
    ar: `رمز التحقق في ${BRAND.ar}: ${code}\nصالح ${minutes} دقيقة. لا تشاركه مع أحد.`,
    en: `${BRAND.en} code: ${code}\nValid for ${minutes} minutes. Never share it.`,
  })),
};

export async function sendSms<P>(to: string, template: SmsTemplate<P>, params: P, lang: Lang): Promise<void> {
  await smsSender().send({ to, text: template.render(params, lang), lang });
}

// ---------------------------------------------------------------------------- email

export type EmailContent = { subject: string; text: string };
export type EmailTemplate<P> = (params: P, lang: Lang) => EmailContent;

function emailTemplate<P>(content: (params: P) => { subject: Bi; text: Bi }): EmailTemplate<P> {
  return (params, lang) => {
    const { subject, text } = content(params);
    return { subject: pick(subject, lang), text: pick(text, lang) };
  };
}

export const EMAIL = {
  verifyEmail: emailTemplate(({ link }: { link: string }) => ({
    subject: { ar: `أكّد بريدك الإلكتروني في ${BRAND.ar}`, en: `Confirm your email for ${BRAND.en}` },
    text: {
      ar: `مرحباً،\n\nلتأكيد بريدك الإلكتروني افتح الرابط التالي:\n${link}\n\nالرابط صالح لمدة 24 ساعة. إن لم تنشئ حساباً في ${BRAND.ar} فتجاهل هذه الرسالة.`,
      en: `Hello,\n\nOpen this link to confirm your email address:\n${link}\n\nThe link is valid for 24 hours. If you did not create a ${BRAND.en} account, ignore this message.`,
    },
  })),

  passwordReset: emailTemplate(({ link, minutes }: { link: string; minutes: number }) => ({
    subject: { ar: `إعادة تعيين كلمة المرور في ${BRAND.ar}`, en: `Reset your ${BRAND.en} password` },
    text: {
      ar: `مرحباً،\n\nلإعادة تعيين كلمة المرور افتح الرابط التالي:\n${link}\n\nالرابط صالح لمدة ${minutes} دقيقة ويُستخدم مرة واحدة. إن لم تطلب ذلك فتجاهل هذه الرسالة؛ كلمة مرورك لم تتغير.`,
      en: `Hello,\n\nOpen this link to reset your password:\n${link}\n\nThe link is valid for ${minutes} minutes and works once. If you did not ask for this, ignore this message; your password has not changed.`,
    },
  })),

  teamInvite: emailTemplate(({ link, store, days }: { link: string; store: string; days: number }) => ({
    subject: { ar: `دعوة للانضمام إلى فريق ${store} في ${BRAND.ar}`, en: `You are invited to join ${store} on ${BRAND.en}` },
    text: {
      ar: `مرحباً،\n\nدُعيت للانضمام إلى فريق متجر «${store}» في ${BRAND.ar}. لقبول الدعوة افتح الرابط التالي وسجّل الدخول بهذا البريد الإلكتروني:\n${link}\n\nالرابط صالح لمدة ${days} أيام ويُستخدم مرة واحدة. إن لم تتوقع هذه الدعوة فتجاهل الرسالة.`,
      en: `Hello,\n\nYou have been invited to join the team of "${store}" on ${BRAND.en}. To accept, open this link and sign in with this email address:\n${link}\n\nThe link is valid for ${days} days and works once. If you were not expecting this, ignore this message.`,
    },
  })),
};

export async function sendEmail<P>(to: string, template: EmailTemplate<P>, params: P, lang: Lang): Promise<void> {
  await emailSender().send({ to, ...template(params, lang), lang });
}
