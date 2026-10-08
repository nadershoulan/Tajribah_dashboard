'use client';

// AUTH-002 — Create an account

import { STORE_LINKING } from '@/lib/features';
import { useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { useLang } from '@/lib/i18n';
import { AuthTop } from './AuthTop';
import { useAuth } from '@/lib/auth';
import { authErrorMessage } from './auth-errors';
import { safeNext } from '@/lib/safe-next';
import { slugify } from '@/lib/slug';
import { PASSWORDS_DIFFER, passwordsDiffer } from '@/lib/password-confirm';
import { TRIAL_DAYS, TRIAL_PLAN, planByCode, type PlanCode } from '@/lib/plans';
import { PasswordInput } from '@/components/dashboard/password-input';
import { TURNSTILE_WAIT, useAuthTurnstile } from './auth-turnstile';

export default function Register() {
  const { t, lang } = useLang();
  const env = useEnv();
  const auth = useAuth();
  const [storeName, setStoreName] = useState('');
  const [note, setNote] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [differ, setDiffer] = useState(false);
  const human = useAuthTurnstile('register');

  // T49: arriving from a team invitation (`?next=/invite/<token>`): an account only, no store of its own.
  const next = new URLSearchParams(env.search).get('next');
  const invitation = next?.startsWith('/invite/') ? decodeURIComponent(next.slice('/invite/'.length)) : null;
  const slug = slugify(storeName);
  // T32: a plan chosen on the website's pricing page. The trial itself runs on Growth's features
  // (T35: `implicitPlan`), so the page says so plainly when another plan was chosen.
  const asked = new URLSearchParams(env.search).get('plan');
  const chosen = asked === 'starter' || asked === 'growth' || asked === 'pro' ? planByCode(asked as PlanCode) : null;
  const trial = planByCode(TRIAL_PLAN).name;
  // §13.6: never derive a slug from an Arabic name without showing the merchant the result.
  const needsConfirmation = storeName.trim().length > 2 && slug === null;

  const onSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const typed = new FormData(event.currentTarget);
    if (passwordsDiffer(String(typed.get('password') ?? ''), String(typed.get('passwordAgain') ?? ''))) {
      setDiffer(true);
      document.getElementById('passwordAgain')?.focus();
      return;
    }
    if (!auth.live) {
      setNote(t('هذه معاينة ثابتة بدون خادم — لا يُنشأ حساب فعلي.', 'This is a static preview with no server — no account is created.'));
      return;
    }
    if (!human.ready) { setNote(t(TURNSTILE_WAIT.ar, TURNSTILE_WAIT.en)); return; }
    const form = new FormData(event.currentTarget);
    const phone = String(form.get('phone') ?? '').trim();
    setPending(true);
    setNote(null);
    try {
      const person = {
        fullName: String(form.get('fullName') ?? ''),
        email: String(form.get('email') ?? ''),
        password: String(form.get('password') ?? ''),
        locale: lang,
        ...(phone ? { phone } : {}),
        ...(human.token ? { turnstileToken: human.token } : {}),
      };
      if (invitation) {
        // Joined already: straight into the team's store.
        await auth.register({ ...person, invitation });
        env.navigate('/dashboard');
        return;
      }
      await auth.register({ ...person, storeName });
      // Back to where the visitor was sent from, through the same allow-list as sign-in;
      // otherwise straight into the setup guide (P1.2).
      env.navigate(safeNext(next, '/dashboard/onboarding'));
    } catch (error) {
      setNote(authErrorMessage(error, t));
      human.reset(); // the token was spent on this attempt
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="auth-wrap">
      <aside className="auth-side">
        <img src={env.asset('/brand/tajribah-wordmark-light.png')} alt="Tajribah تجربة" />
        <h2>{invitation ? t('انضم إلى فريقك على تجربة.', 'Join your team on Tajribah.') : t(`ابدأ بتجربة مجانية ${TRIAL_DAYS} يومًا.`, `Start with a ${TRIAL_DAYS}-day free trial.`)}</h2>
        {!invitation && <ul>
          {[
            t('بدون بطاقة بنكية', 'No card required'),
            STORE_LINKING ? t('اربط سلة أو زد واستورد منتجاتك في دقائق', 'Connect Salla or Zid and import your catalogue in minutes') : t('استورد منتجاتك من رابط متجرك أو ملف في دقائق', 'Import your products from your store’s feed link or a file in minutes'),
            t('ألغِ في أي وقت', 'Cancel any time'),
          ].map((line) => (
            <li key={line}><Check size={16} aria-hidden />{line}</li>
          ))}
        </ul>}
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <AuthTop />
          <h1>{invitation ? t('أنشئ حسابك للانضمام إلى الفريق', 'Create your account to join the team') : t('أنشئ متجرك على تجربة', 'Create your store on Tajribah')}</h1>
          <p>{invitation
            ? t('استخدم البريد الذي وصلته الدعوة. تنضم إلى الفريق مباشرة، دون متجر خاص بك.', 'Use the email address the invitation was sent to. You join the team straight away, with no store of your own.')
            : STORE_LINKING ? t('دقيقتان، ثم نربط متجرك.', 'Two minutes, then we connect your store.') : t('دقيقتان، ثم نستورد منتجاتك.', 'Two minutes, then we import your products.')}</p>
          {chosen && !invitation && (
            <p className="auth-plan-note" role="note">
              {chosen.code === TRIAL_PLAN
                ? t(`اخترت باقة ${chosen.name.ar}. تبدأ تجربتك المجانية لمدة ${TRIAL_DAYS} يومًا عليها الآن.`, `You chose ${chosen.name.en}. Your ${TRIAL_DAYS}-day free trial starts on it now.`)
                : t(`اخترت باقة ${chosen.name.ar}. تبدأ التجربة المجانية لمدة ${TRIAL_DAYS} يومًا بمزايا باقة ${trial.ar}، وتختار ${chosen.name.ar} من صفحة الفوترة متى شئت.`,
                  `You chose ${chosen.name.en}. The ${TRIAL_DAYS}-day free trial runs on the ${trial.en} plan’s features; choose ${chosen.name.en} from Billing whenever you like.`)}
            </p>
          )}

          <form onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="fullName">{t('اسمك', 'Your name')}</label>
              <input id="fullName" name="fullName" autoComplete="name" required />
            </div>

            {!invitation && <div className="field">
              <label htmlFor="storeName">{t('اسم المتجر', 'Store name')}</label>
              <input id="storeName" value={storeName} onChange={(e) => setStoreName(e.target.value)} required />
              {slug && (
                <span className="field-hint" dir="ltr">
                  tajribah.org/{slug}
                </span>
              )}
              {needsConfirmation && (
                <span className="field-hint" style={{ color: 'var(--warn)' }}>
                  {t(
                    'سنقترح عليك رابطًا إنجليزيًا بعد التسجيل — لن نحوّل الاسم العربي تلقائيًا دون أن تراه.',
                    'We will suggest a Latin URL after signup — we will not transliterate your Arabic name without showing you first.',
                  )}
                </span>
              )}
            </div>}

            <div className="field">
              <label htmlFor="email">{t('البريد الإلكتروني', 'Email')}</label>
              <input id="email" name="email" type="email" autoComplete="email" dir="ltr" required />
            </div>

            <div className="field">
              <label htmlFor="phone">{t('رقم الجوال', 'Mobile number')}</label>
              <input id="phone" name="phone" type="tel" autoComplete="tel" dir="ltr" placeholder="05X XXX XXXX" />
              <span className="field-hint">{t('لتأكيد الحساب برسالة نصية.', 'To confirm your account by SMS.')}</span>
            </div>

            <div className="field">
              <label htmlFor="password">{t('كلمة المرور', 'Password')}</label>
              <PasswordInput id="password" name="password" autoComplete="new-password" minLength={10} required />
              <span className="field-hint">{t('10 أحرف على الأقل.', 'At least 10 characters.')}</span>
            </div>

            <div className="field">
              <label htmlFor="passwordAgain">{t('أكّد كلمة المرور', 'Confirm the password')}</label>
              <PasswordInput id="passwordAgain" name="passwordAgain" autoComplete="new-password" required
                aria-invalid={differ} aria-describedby={differ ? 'passwordAgain-error' : undefined} onChange={() => setDiffer(false)} />
              {differ && <span id="passwordAgain-error" className="field-error">{t(PASSWORDS_DIFFER.ar, PASSWORDS_DIFFER.en)}</span>}
            </div>

            {human.widget}

            {note && <p className="field-hint" role="alert" style={{ color: 'var(--warn)', marginBottom: 12 }}>{note}</p>}

            <button type="submit" className="btn btn-accent" style={{ width: '100%', justifyContent: 'center' }} disabled={pending}>
              {invitation
                ? (pending ? t('جارٍ الانضمام…', 'Joining…') : t('أنشئ الحساب وانضم', 'Create the account and join'))
                : (pending ? t('جارٍ إنشاء المتجر…', 'Creating your store…') : t('ابدأ التجربة', 'Start the trial'))}
            </button>
          </form>

          <p className="hint" style={{ marginTop: 12 }}>
            {t(
              'بإنشاء الحساب فإنك توافق على شروط الاستخدام وسياسة الخصوصية.',
              'By creating an account you agree to the terms of use and the privacy policy.',
            )}
          </p>
          <p style={{ marginTop: 10, fontSize: 14, color: 'var(--text-2)' }}>
            {t('لديك حساب؟', 'Already have an account?')}{' '}
            <AppLink href={invitation ? `/login?next=${encodeURIComponent(next!)}` : '/login'} style={{ color: 'var(--aqua-ink)' }}>{t('سجّل الدخول', 'Sign in')}</AppLink>
          </p>
        </div>
      </main>
    </div>
  );
}
