/**
 * P0.9 — every message the platform sends, in both languages, in one file.
 *
 * SMS templates are length-checked **when this module loads**: `smsTemplate` renders its
 * worst-case sample in Arabic and English and throws if either would cost a second part.
 * A too-long Arabic OTP therefore stops the server booting and fails the test suite; it
 * never reaches a merchant as a three-part message (§11 — Arabic is 70 characters per part).
 *
 * Email always has a plain-text body (a mail with no text part lands in spam) and, since T119, a branded
 * HTML part built from that same text — see emailHtml.
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

export type EmailContent = { subject: string; text: string; html: string };
export type EmailTemplate<P> = (params: P, lang: Lang) => EmailContent;

/** The wordmark served by the site; mail clients fetch it (Gmail through its own image proxy). */
const LOGO = 'https://tajribah.org/brand/tajribah-wordmark.png';
const URL_LINE = /^https?:\/\/\S+$/;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/**
 * The HTML part, built from the text part so the two never say different things: each paragraph of the text
 * becomes a paragraph, and a line that is only a link becomes a button (labelled `cta`) with the address under it
 * for clients that strip buttons. Tables and inline styles only — what Gmail, Outlook and Apple Mail all render.
 * `dir` is set on every block, so an Arabic mail reads right to left even where a client drops <html dir>.
 */
export function emailHtml(subject: string, text: string, lang: Lang, cta?: string): string {
  const dir = lang === 'ar' ? 'rtl' : 'ltr';
  const align = lang === 'ar' ? 'right' : 'left';
  const font = lang === 'ar' ? "Tahoma,'Segoe UI',Arial,sans-serif" : "-apple-system,'Segoe UI',Roboto,Arial,sans-serif";
  const p = `margin:0 0 16px;font-size:16px;line-height:1.75;color:#0a2237;text-align:${align}`;
  const blocks = text.trim().split(/\n{2,}/).map((para) => {
    const lines = para.split('\n');
    const out: string[] = [];
    let words: string[] = [];
    const flush = () => { if (words.length) out.push(`<p dir="${dir}" style="${p}">${words.map(escapeHtml).join('<br>')}</p>`); words = []; };
    for (const line of lines) {
      if (!URL_LINE.test(line.trim())) { words.push(line); continue; }
      flush();
      const href = escapeHtml(line.trim());
      out.push(
        `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 12px"><tr><td style="border-radius:10px;background:#00a7bc">`
        + `<a href="${href}" target="_blank" style="display:inline-block;padding:13px 28px;font-size:16px;font-weight:bold;color:#ffffff;text-decoration:none;border-radius:10px;font-family:${font}">${escapeHtml(cta ?? pick(OPEN, lang))}</a>`
        + `</td></tr></table>`
        + `<p dir="${dir}" style="margin:0 0 16px;font-size:13px;line-height:1.6;color:#5b6b78;text-align:${align}">${escapeHtml(pick(FALLBACK, lang))}<br>`
        + `<a href="${href}" target="_blank" dir="ltr" style="color:#00809a;word-break:break-all">${href}</a></p>`,
      );
    }
    flush();
    return out.join('');
  }).join('');
  const footer = lang === 'ar'
    ? `${BRAND.ar} — تجربة افتراضية ومقارنة بالحجم الحقيقي لمتاجر الساعات والمجوهرات.<br>رسالة آلية؛ للتواصل معنا: <a href="https://tajribah.org/contact" style="color:#00809a">tajribah.org/contact</a>`
    : `${BRAND.en} — virtual try-on and true-size comparison for watch and jewellery stores.<br>An automatic message; to reach us: <a href="https://tajribah.org/contact" style="color:#00809a">tajribah.org/contact</a>`;
  return `<!doctype html>
<html lang="${lang}" dir="${dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:0;background:#f6f9fb;font-family:${font}">
<div style="display:none;max-height:0;overflow:hidden">${escapeHtml(subject)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f9fb"><tr><td align="center" style="padding:28px 12px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px">
<tr><td align="center" style="padding:0 0 20px"><img src="${LOGO}" width="168" height="36" alt="${escapeHtml(pick(BRAND, lang))}" style="display:block;border:0;height:36px;width:168px"></td></tr>
<tr><td dir="${dir}" style="background:#ffffff;border:1px solid #dce6ec;border-radius:16px;padding:32px 28px;text-align:${align};font-family:${font}">
<h1 dir="${dir}" style="margin:0 0 20px;font-size:21px;line-height:1.5;color:#0a2237;text-align:${align}">${escapeHtml(subject)}</h1>
${blocks}
</td></tr>
<tr><td dir="${dir}" style="padding:20px 8px 0;font-size:12px;line-height:1.7;color:#5b6b78;text-align:center;font-family:${font}">${footer}</td></tr>
</table></td></tr></table></body></html>`;
}

const OPEN: Bi = { ar: 'افتح الرابط', en: 'Open the link' };
const FALLBACK: Bi = { ar: 'إن لم يعمل الزر فانسخ هذا الرابط إلى المتصفح:', en: 'If the button does not work, copy this link into your browser:' };

function emailTemplate<P>(content: (params: P) => { subject: Bi; text: Bi; cta?: Bi }): EmailTemplate<P> {
  return (params, lang) => {
    const { subject, text, cta } = content(params);
    const s = pick(subject, lang), t = pick(text, lang);
    return { subject: s, text: t, html: emailHtml(s, t, lang, cta && pick(cta, lang)) };
  };
}

export const EMAIL = {
  verifyEmail: emailTemplate(({ link }: { link: string }) => ({
    subject: { ar: `أكّد بريدك الإلكتروني في ${BRAND.ar}`, en: `Confirm your email for ${BRAND.en}` },
    cta: { ar: 'تأكيد البريد الإلكتروني', en: 'Confirm my email' },
    text: {
      ar: `مرحباً،\n\nلتأكيد بريدك الإلكتروني افتح الرابط التالي:\n${link}\n\nالرابط صالح لمدة 24 ساعة. إن لم تنشئ حساباً في ${BRAND.ar} فتجاهل هذه الرسالة.`,
      en: `Hello,\n\nOpen this link to confirm your email address:\n${link}\n\nThe link is valid for 24 hours. If you did not create a ${BRAND.en} account, ignore this message.`,
    },
  })),

  passwordReset: emailTemplate(({ link, minutes }: { link: string; minutes: number }) => ({
    subject: { ar: `إعادة تعيين كلمة المرور في ${BRAND.ar}`, en: `Reset your ${BRAND.en} password` },
    cta: { ar: 'إعادة تعيين كلمة المرور', en: 'Reset my password' },
    text: {
      ar: `مرحباً،\n\nلإعادة تعيين كلمة المرور افتح الرابط التالي:\n${link}\n\nالرابط صالح لمدة ${minutes} دقيقة ويُستخدم مرة واحدة. إن لم تطلب ذلك فتجاهل هذه الرسالة؛ كلمة مرورك لم تتغير.`,
      en: `Hello,\n\nOpen this link to reset your password:\n${link}\n\nThe link is valid for ${minutes} minutes and works once. If you did not ask for this, ignore this message; your password has not changed.`,
    },
  })),

  teamInvite: emailTemplate(({ link, store, days }: { link: string; store: string; days: number }) => ({
    subject: { ar: `دعوة للانضمام إلى فريق ${store} في ${BRAND.ar}`, en: `You are invited to join ${store} on ${BRAND.en}` },
    cta: { ar: 'قبول الدعوة', en: 'Accept the invitation' },
    text: {
      ar: `مرحباً،\n\nدُعيت للانضمام إلى فريق متجر «${store}» في ${BRAND.ar}. لقبول الدعوة افتح الرابط التالي وسجّل الدخول بهذا البريد الإلكتروني:\n${link}\n\nالرابط صالح لمدة ${days} أيام ويُستخدم مرة واحدة. إن لم تتوقع هذه الدعوة فتجاهل الرسالة.`,
      en: `Hello,\n\nYou have been invited to join the team of "${store}" on ${BRAND.en}. To accept, open this link and sign in with this email address:\n${link}\n\nThe link is valid for ${days} days and works once. If you were not expecting this, ignore this message.`,
    },
  })),

  /** P2.13: an invoice was issued. */
  invoiceIssued: emailTemplate(({ number, total, link, store }: { number: string; total: string; link: string; store: string }) => ({
    subject: { ar: `فاتورة ${number} — ${store}`, en: `Invoice ${number} — ${store}` },
    cta: { ar: 'عرض الفاتورة', en: 'View the invoice' },
    text: {
      ar: `مرحباً،\n\nصدرت فاتورة جديدة لمتجر «${store}» بمبلغ ${total} شامل ضريبة القيمة المضافة.\n\nاعرضها أو اطبعها من هنا:\n${link}`,
      en: `Hello,\n\nA new invoice was issued to "${store}" for ${total} including VAT.\n\nView or print it here:\n${link}`,
    },
  })),

  /** P2.13: a payment failed (sent by dunning, P2.8). */
  paymentFailed: emailTemplate(({ amount, link, store, retryAt }: { amount: string; link: string; store: string; retryAt: Date | null }) => ({
    subject: { ar: `تعذّر تحصيل الدفعة — ${store}`, en: `A payment did not go through — ${store}` },
    cta: { ar: 'تحديث طريقة الدفع', en: 'Update payment method' },
    text: {
      ar: `مرحباً،\n\nلم نتمكن من تحصيل ${amount} لمتجر «${store}».${retryAt ? ` سنحاول مرة أخرى في ${formatDate(retryAt, 'ar')}.` : ''} حدّث طريقة الدفع حتى لا يتوقف متجرك:\n${link}`,
      en: `Hello,\n\nWe could not collect ${amount} for "${store}".${retryAt ? ` We will try again on ${formatDate(retryAt, 'en')}.` : ''} Update your payment method so your store keeps running:\n${link}`,
    },
  })),

  /** T129: the store sent a bank transfer request — what happens next. */
  transferSubmitted: emailTemplate(({ store, reference, plan, total, bank, iban, hours, link }: { store: string; reference: string; plan: Bi; total: string; bank: string; iban: string; hours: number; link: string }) => ({
    subject: { ar: `استلمنا طلب التحويل ${reference} — ${store}`, en: `We have your transfer request ${reference} — ${store}` },
    cta: { ar: 'متابعة الطلب', en: 'Follow the request' },
    text: {
      ar: `مرحباً،\n\nاستلمنا طلب الاشتراك في باقة ${plan.ar} بالتحويل البنكي لمتجر «${store}».\n\nالمرجع: ${reference}\nالمبلغ: ${total} شامل ضريبة القيمة المضافة\nإلى: ${bank} — ${iban}\n\nنراجع التحويل خلال ${hours} ساعة عمل تقريباً، ونفعّل اشتراكك فور التحقق ونرسل لك الفاتورة. تابع الطلب من هنا:\n${link}`,
      en: `Hello,\n\nWe have the request to subscribe "${store}" to the ${plan.en} plan by bank transfer.\n\nReference: ${reference}\nAmount: ${total} including VAT\nTo: ${bank} — ${iban}\n\nWe check transfers within about ${hours} working hours, switch your plan on as soon as it is confirmed, and send you the invoice. Follow the request here:\n${link}`,
    },
  })),

  /** T129: to Tajribah staff — a transfer to check, sent again, or cancelled by the store. */
  transferForStaff: emailTemplate(({ kind, store, reference, plan, total, sender, link }: { kind: 'new' | 'resubmitted' | 'cancelled'; store: string; reference: string; plan: Bi; total: string; sender: string; link: string }) => ({
    subject: kind === 'new'
      ? { ar: `تحويل بنكي جديد للمراجعة ${reference} — ${store}`, en: `New bank transfer to check ${reference} — ${store}` }
      : kind === 'resubmitted'
        ? { ar: `أعاد المتجر إرسال التحويل ${reference} — ${store}`, en: `Transfer ${reference} sent again — ${store}` }
        : { ar: `ألغى المتجر طلب التحويل ${reference} — ${store}`, en: `Transfer ${reference} cancelled by the store — ${store}` },
    cta: { ar: 'فتح الطلب', en: 'Open the request' },
    text: {
      ar: `متجر «${store}»\nالمرجع: ${reference}\nالباقة: ${plan.ar}\nالمبلغ: ${total}\nالمحوِّل: ${sender}\n\n${kind === 'cancelled' ? 'لا يلزم إجراء.' : 'تحقق من وصول المبلغ في كشف الحساب، ثم اقبل الطلب أو ارفضه:'}\n${link}`,
      en: `Store "${store}"\nReference: ${reference}\nPlan: ${plan.en}\nAmount: ${total}\nSent by: ${sender}\n\n${kind === 'cancelled' ? 'Nothing to do.' : 'Check the money arrived on the bank statement, then approve or decline:'}\n${link}`,
    },
  })),

  /** T129: staff need more from the store before deciding. */
  transferInfoRequested: emailTemplate(({ store, reference, message, link }: { store: string; reference: string; message: string; link: string }) => ({
    subject: { ar: `نحتاج معلومة إضافية عن التحويل ${reference} — ${store}`, en: `We need a little more about transfer ${reference} — ${store}` },
    cta: { ar: 'أكمل الطلب', en: 'Complete the request' },
    text: {
      ar: `مرحباً،\n\nراجعنا طلب التحويل ${reference} لمتجر «${store}»، ونحتاج قبل تفعيل الاشتراك إلى:\n\n${message}\n\nأرفق المطلوب وأعد إرسال الطلب من هنا:\n${link}`,
      en: `Hello,\n\nWe looked at transfer ${reference} for "${store}". Before we switch the plan on, we need:\n\n${message}\n\nAdd it and send the request again here:\n${link}`,
    },
  })),

  /** T129: the transfer was confirmed — the plan is on, with its invoice. */
  transferApproved: emailTemplate(({ store, reference, plan, until, link }: { store: string; reference: string; plan: Bi; until: Date; link: string }) => ({
    subject: { ar: `تم تفعيل اشتراكك — ${store}`, en: `Your plan is on — ${store}` },
    cta: { ar: 'عرض الفاتورة', en: 'View the invoice' },
    text: {
      ar: `مرحباً،\n\nتحققنا من التحويل ${reference}، وفُعّلت باقة ${plan.ar} لمتجر «${store}» حتى ${formatDate(until, 'ar')}. شكراً لك.\n\nفاتورتك الضريبية:\n${link}`,
      en: `Hello,\n\nWe confirmed transfer ${reference}, and the ${plan.en} plan is on for "${store}" until ${formatDate(until, 'en')}. Thank you.\n\nYour tax invoice:\n${link}`,
    },
  })),

  /** T129: the transfer was declined, with staff's reason. */
  transferRejected: emailTemplate(({ store, reference, reason, link }: { store: string; reference: string; reason: string; link: string }) => ({
    subject: { ar: `تعذّر قبول التحويل ${reference} — ${store}`, en: `Transfer ${reference} could not be accepted — ${store}` },
    cta: { ar: 'صفحة الاشتراك', en: 'Billing page' },
    text: {
      ar: `مرحباً،\n\nلم نتمكن من قبول طلب التحويل ${reference} لمتجر «${store}»:\n\n${reason}\n\nيمكنك إرسال طلب جديد من صفحة الاشتراك، أو الرد على هذه الرسالة إن كان لديك سؤال:\n${link}`,
      en: `Hello,\n\nWe could not accept transfer ${reference} for "${store}":\n\n${reason}\n\nYou can send a new request from the Billing page, or reply to this message with any question:\n${link}`,
    },
  })),

  /** T129: a plan paid by transfer is about to end. */
  renewalReminder: emailTemplate(({ store, plan, days, endsAt, link }: { store: string; plan: Bi; days: number; endsAt: Date; link: string }) => ({
    subject: { ar: `يتجدد اشتراكك بعد ${days} ${days === 1 ? 'يوم' : days === 2 ? 'يومين' : days <= 10 ? 'أيام' : 'يوماً'} — ${store}`, en: `Your plan ends in ${days} day${days === 1 ? '' : 's'} — ${store}` },
    cta: { ar: 'جدّد الآن', en: 'Renew now' },
    text: {
      ar: `مرحباً،\n\nتنتهي باقة ${plan.ar} لمتجر «${store}» في ${formatDate(endsAt, 'ar')}. اشتراكك مدفوع بالتحويل البنكي، فلا يتجدد تلقائياً: أرسل تحويل التجديد من صفحة الاشتراك، وتُضاف المدة الجديدة بعد نهاية الحالية دون أن تخسر يوماً:\n${link}`,
      en: `Hello,\n\nThe ${plan.en} plan for "${store}" ends on ${formatDate(endsAt, 'en')}. It is paid by bank transfer, so it does not renew by itself: send the renewal transfer from the Billing page — the new time is added after the current period, so no day is lost:\n${link}`,
    },
  })),

  /** T129: the paid period ended; the store keeps working for the grace days. */
  subscriptionPastDue: emailTemplate(({ store, plan, graceUntil, link }: { store: string; plan: Bi; graceUntil: Date; link: string }) => ({
    subject: { ar: `انتهت مدة اشتراكك — ${store}`, en: `Your plan's paid period has ended — ${store}` },
    cta: { ar: 'جدّد الاشتراك', en: 'Renew the plan' },
    text: {
      ar: `مرحباً،\n\nانتهت المدة المدفوعة من باقة ${plan.ar} لمتجر «${store}». يبقى متجرك يعمل كالمعتاد حتى ${formatDate(graceUntil, 'ar')}؛ بعدها يصبح للاطلاع فقط إلى أن تجدد. أرسل تحويل التجديد من هنا:\n${link}`,
      en: `Hello,\n\nThe paid period of the ${plan.en} plan for "${store}" has ended. Your store keeps working as usual until ${formatDate(graceUntil, 'en')}; after that it becomes read-only until you renew. Send the renewal transfer here:\n${link}`,
    },
  })),

  /** T129: the grace days passed without a renewal; the store is read-only (nothing is deleted). */
  subscriptionExpired: emailTemplate(({ store, plan, link }: { store: string; plan: Bi; link: string }) => ({
    subject: { ar: `متجرك للاطلاع فقط الآن — ${store}`, en: `Your store is read-only now — ${store}` },
    cta: { ar: 'جدّد الاشتراك', en: 'Renew the plan' },
    text: {
      ar: `مرحباً،\n\nانتهت باقة ${plan.ar} لمتجر «${store}» دون تجديد، فأصبح المتجر للاطلاع فقط وتوقفت أزرار التجربة في متجرك. لم يُحذف شيء: يعود كل شيء كما كان فور تجديد الاشتراك:\n${link}`,
      en: `Hello,\n\nThe ${plan.en} plan for "${store}" ended without a renewal, so the store is read-only and its try-on buttons have stopped on your shop. Nothing was deleted: everything comes back as it was once you renew:\n${link}`,
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
    cta: { ar: 'فتح التحليلات', en: 'Open Analytics' },
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
