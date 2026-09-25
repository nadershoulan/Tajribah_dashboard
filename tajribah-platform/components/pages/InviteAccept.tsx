'use client';

// AUTH-003 — Accept a team invitation

import { useState } from 'react';
import { Users } from 'lucide-react';
import { AppLink, useEnv } from '@/lib/app-env';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useLang } from '@/lib/i18n';
import { LangToggle } from '@/components/dashboard/chrome';

export default function InviteAccept() {
  const { t } = useLang();
  const env = useEnv();
  const auth = useAuth();
  const token = decodeURIComponent(env.path.split('/').filter(Boolean).pop() ?? '');
  const here = `/invite/${encodeURIComponent(token)}`;
  const [pending, setPending] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  const accept = async () => {
    setPending(true);
    setProblem(null);
    try {
      await auth.acceptInvitation(token);
      env.navigate('/dashboard');
    } catch (error) {
      setProblem(error instanceof ApiError && error.status === 404
        ? t('هذه الدعوة غير صالحة: ربما انتهت أو استُخدمت أو أُلغيت، أو أنها لبريد غير البريد الذي سجّلت به الدخول.',
          'This invitation is not valid: it may have expired, been used or cancelled, or it is for a different email than the one you are signed in with.')
        : (error as Error).message);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="auth-wrap">
      <main className="auth-main" style={{ gridColumn: '1 / -1' }}>
        <div className="auth-card">
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 18 }}><LangToggle /></div>
          <span className="empty-icon" style={{ margin: '0 0 12px' }}><Users size={22} aria-hidden /></span>
          <h1>{t('دعوة للانضمام إلى فريق', 'An invitation to join a team')}</h1>

          {auth.status === 'loading' && <p>{t('لحظة…', 'One moment…')}</p>}

          {auth.status === 'signed-out' && (
            <>
              <p>{t('سجّل الدخول بالبريد الذي وصلته الدعوة، ثم نضيفك إلى الفريق.', 'Sign in with the email address the invitation was sent to, and we add you to the team.')}</p>
              <AppLink href={`/login?next=${encodeURIComponent(here)}`} className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }}>
                {t('سجّل الدخول للقبول', 'Sign in to accept')}
              </AppLink>
              <p style={{ marginTop: 14, fontSize: 14, color: 'var(--text-2)' }}>
                {t('ليس لديك حساب بهذا البريد؟', 'No account with that email yet?')}{' '}
                <AppLink href={`/register?next=${encodeURIComponent(here)}`} style={{ color: 'var(--aqua)' }}>{t('أنشئ حسابًا', 'Create one')}</AppLink>
              </p>
            </>
          )}

          {auth.status === 'signed-in' && (
            <>
              <p>
                {t('ستنضم بالحساب', 'You will join as')} <strong dir="ltr">{auth.me?.user.email}</strong>.{' '}
                {t('يجب أن يكون هو البريد الذي وصلته الدعوة.', 'It must be the address the invitation was sent to.')}
              </p>
              {problem && <p className="field-hint" role="alert" style={{ color: 'var(--bad)', marginBottom: 12 }}>{problem}</p>}
              <button type="button" className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} onClick={accept} disabled={pending || !auth.live}>
                {pending ? t('جارٍ الانضمام…', 'Joining…') : t('انضم إلى الفريق', 'Join the team')}
              </button>
              {!auth.live && <p className="hint">{t('هذه معاينة بلا خادم: القبول يعمل في التطبيق الحقيقي.', 'This is a preview with no server: accepting works in the real app.')}</p>}
            </>
          )}
        </div>
      </main>
    </div>
  );
}
