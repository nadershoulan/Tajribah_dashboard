/**
 * What a sign-in or sign-up form says when the API refuses. Bilingual, and never the raw
 * server text: `invalid_credentials` deliberately does not say which half was wrong.
 */
import { ApiError } from '@/lib/api-client';

type T = (ar: string, en: string) => string;

export function authErrorMessage(error: unknown, t: T): string {
  if (!(error instanceof ApiError)) {
    return t('تعذّر الاتصال بالخادم. تحقّق من الإنترنت وحاول مرة أخرى.', 'Could not reach the server. Check your connection and try again.');
  }
  switch (error.code) {
    case 'invalid_credentials':
      return t('البريد الإلكتروني أو كلمة المرور غير صحيحة.', 'The email or password is not correct.');
    case 'rate_limited':
      return t('محاولات كثيرة. انتظر قليلًا ثم حاول مرة أخرى.', 'Too many attempts. Wait a moment and try again.');
    case 'conflict':
      return t('هذا البريد مسجّل مسبقًا — سجّل الدخول بدلًا من ذلك.', 'This email already has an account — sign in instead.');
    case 'validation_failed': {
      const fields = Object.keys(error.fields ?? {});
      if (fields.includes('turnstileToken')) return t('لم يكتمل التحقق الأمني. انتظر حتى يظهر التأكيد أسفل النموذج ثم حاول مرة أخرى.', 'The security check did not pass. Wait for it to finish below the form, then try again.');
      if (fields.includes('password')) return t('كلمة المرور يجب أن تكون 10 أحرف على الأقل.', 'The password must be at least 10 characters.');
      if (fields.includes('email')) return t('البريد الإلكتروني غير صالح.', 'That email address is not valid.');
      return t('تحقّق من الحقول وحاول مرة أخرى.', 'Check the fields and try again.');
    }
    default:
      return t(`حدث خطأ غير متوقع (${error.requestId ?? error.status}).`, `Something went wrong (${error.requestId ?? error.status}).`);
  }
}
