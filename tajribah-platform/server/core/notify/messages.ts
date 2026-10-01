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
import { formatDate } from '@/lib/format';
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

  /** P2.13: an invoice was issued. */
  invoiceIssued: emailTemplate(({ number, total, link, store }: { number: string; total: string; link: string; store: string }) => ({
    subject: { ar: `فاتورة ${number} — ${store}`, en: `Invoice ${number} — ${store}` },
    text: {
      ar: `مرحباً،\n\nصدرت فاتورة جديدة لمتجر «${store}» بمبلغ ${total} شامل ضريبة القيمة المضافة.\n\nاعرضها أو اطبعها من هنا:\n${link}`,
      en: `Hello,\n\nA new invoice was issued to "${store}" for ${total} including VAT.\n\nView or print it here:\n${link}`,
    },
  })),

  /** P2.13: a payment failed (sent by dunning, P2.8). */
  paymentFailed: emailTemplate(({ amount, link, store, retryAt }: { amount: string; link: string; store: string; retryAt: Date | null }) => ({
    subject: { ar: `تعذّر تحصيل الدفعة — ${store}`, en: `A payment did not go through — ${store}` },
    text: {
      ar: `مرحباً،\n\nلم نتمكن من تحصيل ${amount} لمتجر «${store}».${retryAt ? ` سنحاول مرة أخرى في ${formatDate(retryAt, 'ar')}.` : ''} حدّث طريقة الدفع حتى لا يتوقف متجرك:\n${link}`,
      en: `Hello,\n\nWe could not collect ${amount} for "${store}".${retryAt ? ` We will try again on ${formatDate(retryAt, 'en')}.` : ''} Update your payment method so your store keeps running:\n${link}`,
    },
  })),

  /** P2.11: a trial reminder (3 days left, last day, ended). The wording is the in-app one. */
  trialReminder: emailTemplate(({ title, body, store }: { title: Bi; body: Bi; store: string }) => ({
    subject: { ar: `${title.ar} — ${store}`, en: `${title.en} — ${store}` },
    text: {
      ar: `مرحباً،\n\n${body.ar}\n\nاختر باقتك من صفحة الاشتراك في لوحة ${BRAND.ar}.`,
      en: `Hello,\n\n${body.en}\n\nChoose your plan on the Billing page of your ${BRAND.en} dashboard.`,
    },
  })),

  /** P4.8: the week's figures, to a member who asked for them (`analytics/report.ts`). */
  weeklyReport: emailTemplate(({ store, period, lines, link }: { store: string; period: Bi; lines: Bi; link: string }) => ({
    subject: { ar: `ملخص الأسبوع — ${store}`, en: `Your week — ${store}` },
    text: {
      ar: `مرحباً،\n\nملخص متجر «${store}» ${period.ar}:\n\n${lines.ar}\n\nالتفاصيل في صفحة التحليلات:\n${link}\n\nتصلك هذه الرسالة كل أحد لأنك فعّلت الملخص الأسبوعي في ${BRAND.ar}. لإيقافها افتح صفحة التحليلات وأوقف «ملخص أسبوعي بالبريد».`,
      en: `Hello,\n\n"${store}", ${period.en}:\n\n${lines.en}\n\nThe detail is on the Analytics page:\n${link}\n\nYou get this every Sunday because you turned on the weekly summary in ${BRAND.en}. To stop it, open the Analytics page and turn off "Weekly summary by email".`,
    },
  })),

  /** P1.2b: sent on every change, so a change the owner did not make is noticed. */
  twoFactorChanged: emailTemplate(({ on }: { on: boolean }) => ({
    subject: on
      ? { ar: `تم تفعيل التحقق بخطوتين في ${BRAND.ar}`, en: `Two-step sign-in is on for your ${BRAND.en} account` }
      : { ar: `تم إيقاف التحقق بخطوتين في ${BRAND.ar}`, en: `Two-step sign-in is off for your ${BRAND.en} account` },
    text: on
      ? {
        ar: `مرحباً،\n\nفُعّل التحقق بخطوتين على حسابك: سيُطلب رمز من تطبيق المصادقة بعد كلمة المرور. احتفظ برموز الاستعداد في مكان آمن.\n\nإن لم تفعل ذلك بنفسك فغيّر كلمة المرور فوراً وتواصل معنا.`,
        en: `Hello,\n\nTwo-step sign-in is now on for your account: after your password you will be asked for a code from your authenticator app. Keep your backup codes somewhere safe.\n\nIf this was not you, change your password now and contact us.`,
      }
      : {
        ar: `مرحباً،\n\nأُوقف التحقق بخطوتين على حسابك: كلمة المرور وحدها تكفي الآن لتسجيل الدخول.\n\nإن لم تفعل ذلك بنفسك فغيّر كلمة المرور فوراً وتواصل معنا.`,
        en: `Hello,\n\nTwo-step sign-in is now off for your account: your password alone signs you in.\n\nIf this was not you, change your password now and contact us.`,
      },
  })),
  /** A5: staff reset it (the lost-phone case). Every session was ended with it. */
  twoFactorResetByStaff: emailTemplate(() => ({
    subject: { ar: `أوقف فريق ${BRAND.ar} التحقق بخطوتين على حسابك`, en: `${BRAND.en} support turned off two-step sign-in on your account` },
    text: {
      ar: `مرحباً،\n\nأوقف فريق دعم ${BRAND.ar} التحقق بخطوتين على حسابك، وأُنهيت كل جلساتك. سجّل الدخول بكلمة المرور، ثم فعّله من جديد من صفحة الأمان.\n\nإن لم تطلب ذلك فغيّر كلمة المرور فوراً وتواصل معنا.`,
      en: `Hello,\n\n${BRAND.en} support turned off two-step sign-in on your account and signed you out everywhere. Sign in with your password, then turn it back on from the Security page.\n\nIf you did not ask for this, change your password now and contact us.`,
    },
  })),
};

export async function sendEmail<P>(to: string, template: EmailTemplate<P>, params: P, lang: Lang): Promise<void> {
  await emailSender().send({ to, ...template(params, lang), lang });
}
