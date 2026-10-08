'use client';

/**
 * A password field with an eye to show what was typed (Nader, 2026-10-08: sign-up and the security check had
 * none). One component for every password in the dashboard, so the eye is always there, always in the same
 * place: inside the field at its end, vertically centred, a 36px tap target, and it says what it does to a
 * screen reader (show / hide, pressed or not). Passwords are always typed left to right.
 */
import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { useLang } from '@/lib/i18n';

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

export function PasswordInput({ style, ...rest }: Props) {
  const { t } = useLang();
  const [shown, setShown] = useState(false);
  return (
    <div className="password-input" style={{ position: 'relative' }} dir="ltr">
      <input {...rest} type={shown ? 'text' : 'password'} dir="ltr" style={{ ...style, paddingInlineEnd: 46 }} />
      <button
        type="button"
        className="btn btn-quiet"
        onClick={() => setShown((v) => !v)}
        aria-pressed={shown}
        aria-label={shown ? t('إخفاء كلمة المرور', 'Hide password') : t('إظهار كلمة المرور', 'Show password')}
        title={shown ? t('إخفاء كلمة المرور', 'Hide password') : t('إظهار كلمة المرور', 'Show password')}
        style={{ position: 'absolute', insetInlineEnd: 4, top: '50%', transform: 'translateY(-50%)', width: 36, height: 36, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}
      >
        {shown ? <EyeOff size={17} aria-hidden /> : <Eye size={17} aria-hidden />}
      </button>
    </div>
  );
}
