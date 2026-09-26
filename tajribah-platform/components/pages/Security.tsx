'use client';

// AUTH-20 — 2FA setup: choose method · AUTH-21 — QR + verify · AUTH-22 — backup codes

import { useEffect, useState, type FormEvent } from 'react';
import { Copy, Download, KeyRound, MessageSquare, ShieldCheck, Smartphone } from 'lucide-react';
import { ApiError, type TwoFactorStatus } from '@/lib/api-client';
import { useAuth } from '@/lib/auth';
import { useLang } from '@/lib/i18n';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';
import { authErrorMessage } from './auth-errors';

/** The server's field messages this screen meets, in Arabic. */
const MESSAGE_AR: [RegExp, string][] = [
  [/password is not right/, 'كلمة المرور غير صحيحة'],
  [/code is not right/, 'الرمز غير صحيح — أدخل الرمز الظاهر الآن في التطبيق'],
];

type Stage =
  | { kind: 'overview' }
  | { kind: 'password'; purpose: 'setup' | 'codes' | 'disable' }
  | { kind: 'scan'; secret: string; otpauthUrl: string }
  | { kind: 'codes'; codes: string[] };

export default function Security() {
  const { t } = useLang();
  const auth = useAuth();
  const [status, setStatus] = useState<TwoFactorStatus | null>(null);
  const [loadError, setLoadError] = useState<Error | null>(null);
  const [stage, setStage] = useState<Stage>({ kind: 'overview' });

  const reload = () => auth.twoFactor.status().then(setStatus, setLoadError);
  useEffect(() => {
    let live = true;
    auth.twoFactor.status().then((s) => { if (live) setStatus(s); }, (e: Error) => { if (live) setLoadError(e); });
    return () => { live = false; };
  }, [auth.twoFactor]);

  const crumbs = [{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('أمان تسجيل الدخول', 'Sign-in security') }];
  const back = () => { setStage({ kind: 'overview' }); void reload(); };

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('أمان تسجيل الدخول', 'Sign-in security')}
        lead={t(
          'هذه إعدادات حسابك أنت، لا المتجر: تسري على كل متجر تدخل إليه بهذا الحساب.',
          'These are settings for your own account, not the store: they apply to every store you open with this account.',
        )}
      />
      {loadError && <ErrorNote error={loadError} />}
      {!status && !loadError && <Panel><Loading rows={3} /></Panel>}
      {status && stage.kind === 'overview' && <Overview status={status} onStart={(purpose) => setStage({ kind: 'password', purpose })} />}
      {stage.kind === 'password' && (
        <PasswordStep
          purpose={stage.purpose}
          onCancel={back}
          onSetup={(secret, otpauthUrl) => setStage({ kind: 'scan', secret, otpauthUrl })}
          onCodes={(codes) => setStage({ kind: 'codes', codes })}
          onDisabled={back}
        />
      )}
      {stage.kind === 'scan' && <ScanStep secret={stage.secret} otpauthUrl={stage.otpauthUrl} onCancel={back} onEnabled={(codes) => setStage({ kind: 'codes', codes })} />}
      {stage.kind === 'codes' && <CodesStep codes={stage.codes} onDone={back} />}
    </Shell>
  );
}

/** AUTH-20: what is on, and the ways to change it. */
function Overview({ status, onStart }: { status: TwoFactorStatus; onStart: (purpose: 'setup' | 'codes' | 'disable') => void }) {
  const { t } = useLang();
  if (status.enabled) {
    return (
      <Panel
        title={t('التحقق بخطوتين', 'Two-step sign-in')}
        actions={<Badge tone="ok" dot>{t('مفعّل', 'On')}</Badge>}
      >
        <p style={{ marginTop: 0 }}>{t(
          'بعد كلمة المرور نطلب رمزًا من تطبيق المصادقة على جوالك. من يعرف كلمة مرورك وحدها لا يستطيع الدخول.',
          'After your password we ask for a code from the authenticator app on your phone. Someone who only knows your password cannot sign in.',
        )}</p>
        <p className="hint">{t(`بقي ${status.backupCodesLeft} من رموز الاستعداد.`, `${status.backupCodesLeft} backup codes left.`)}
          {status.backupCodesLeft <= 3 && ` ${t('أنشئ رموزًا جديدة قبل أن تنفد.', 'Make new ones before they run out.')}`}</p>
        <div className="btn-row">
          <button type="button" className="btn btn-ghost" onClick={() => onStart('codes')}><KeyRound size={15} aria-hidden />{t('رموز استعداد جديدة', 'New backup codes')}</button>
          <button type="button" className="btn btn-quiet" onClick={() => onStart('disable')}>{t('إيقاف التحقق بخطوتين', 'Turn off two-step sign-in')}</button>
        </div>
      </Panel>
    );
  }
  return (
    <Panel title={t('التحقق بخطوتين', 'Two-step sign-in')} actions={<Badge>{t('غير مفعّل', 'Off')}</Badge>}>
      <p style={{ marginTop: 0 }}>{t(
        'أضف خطوة ثانية بعد كلمة المرور، حتى لا يكفي تسريبها لدخول أحد إلى متجرك. اختر الطريقة:',
        'Add a second step after your password, so a leaked password alone does not get anyone into your store. Choose how:',
      )}</p>
      <div className="method-list">
        <button type="button" className="method" onClick={() => onStart('setup')}>
          <Smartphone size={20} aria-hidden />
          <span>
            <strong>{t('تطبيق المصادقة', 'Authenticator app')} <Badge tone="accent">{t('موصى به', 'Recommended')}</Badge></strong>
            <small>{t('Google Authenticator أو Microsoft Authenticator أو أي تطبيق مشابه. يعمل دون إنترنت.', 'Google Authenticator, Microsoft Authenticator or any similar app. Works offline.')}</small>
          </span>
        </button>
        <div className="method" aria-disabled="true">
          <MessageSquare size={20} aria-hidden />
          <span>
            <strong>{t('رسالة نصية', 'Text message (SMS)')}</strong>
            <small>{t('قريبًا — بانتظار اعتماد مزوّد الرسائل.', 'Coming soon — waiting on the SMS provider.')}</small>
          </span>
        </div>
      </div>
    </Panel>
  );
}

/** Every change asks for the password again: a stolen session alone cannot change this. */
function PasswordStep({ purpose, onCancel, onSetup, onCodes, onDisabled }: {
  purpose: 'setup' | 'codes' | 'disable';
  onCancel: () => void;
  onSetup: (secret: string, otpauthUrl: string) => void;
  onCodes: (codes: string[]) => void;
  onDisabled: () => void;
}) {
  const { t, lang } = useLang();
  const auth = useAuth();
  const [busy, setBusy] = useState(false);
  const [fields, setFields] = useState<Record<string, string[]>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const say = (m?: string) => (m && lang === 'ar' ? MESSAGE_AR.find(([p]) => p.test(m))?.[1] ?? m : m);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const password = String(form.get('password') ?? '');
    const code = String(form.get('code') ?? '').trim();
    setBusy(true);
    setFields({});
    setFailure(null);
    try {
      if (purpose === 'setup') { const s = await auth.twoFactor.startSetup(password); onSetup(s.secret, s.otpauthUrl); }
      if (purpose === 'codes') onCodes((await auth.twoFactor.regenerateBackupCodes(password)).backupCodes);
      if (purpose === 'disable') { await auth.twoFactor.disable(password, code); onDisabled(); }
    } catch (e) {
      if (e instanceof ApiError && e.fields) setFields(e.fields);
      else setFailure(authErrorMessage(e, t));
    } finally {
      setBusy(false);
    }
  };

  const title = purpose === 'setup' ? t('تأكيد كلمة المرور', 'Confirm your password')
    : purpose === 'codes' ? t('رموز استعداد جديدة', 'New backup codes') : t('إيقاف التحقق بخطوتين', 'Turn off two-step sign-in');
  return (
    <Panel title={title} sub={purpose === 'codes' ? t('الرموز القديمة تتوقف عن العمل.', 'The old codes stop working.') : undefined}>
      <form onSubmit={submit} noValidate style={{ maxWidth: 420 }}>
        <div className="field">
          <label htmlFor="sec-password">{t('كلمة المرور', 'Password')}</label>
          <input id="sec-password" name="password" type="password" dir="ltr" autoComplete="current-password" required autoFocus aria-invalid={!!fields.password} />
          {fields.password && <span className="field-error">{say(fields.password[0])}</span>}
        </div>
        {purpose === 'disable' && (
          <div className="field">
            <label htmlFor="sec-code">{t('رمز من التطبيق أو رمز استعداد', 'A code from the app, or a backup code')}</label>
            <input id="sec-code" name="code" dir="ltr" autoComplete="one-time-code" required aria-invalid={!!fields.code} />
            {fields.code && <span className="field-error">{say(fields.code[0])}</span>}
          </div>
        )}
        {failure && <p className="field-hint" role="alert" style={{ color: 'var(--warn)' }}>{failure}</p>}
        {!auth.live && <p className="hint">{t('معاينة بلا خادم: تُقبل أي كلمة مرور.', 'A preview with no server: any password is accepted.')}</p>}
        <div className="btn-row">
          <button type="submit" className={`btn ${purpose === 'disable' ? 'btn-danger' : 'btn-primary'}`} disabled={busy}>
            {busy ? t('لحظة…', 'One moment…') : purpose === 'disable' ? t('أوقفه', 'Turn it off') : t('متابعة', 'Continue')}
          </button>
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>{t('إلغاء', 'Cancel')}</button>
        </div>
      </form>
    </Panel>
  );
}

/** AUTH-21: scan (or type) the key, then prove it with the first code. */
function ScanStep({ secret, otpauthUrl, onCancel, onEnabled }: {
  secret: string; otpauthUrl: string; onCancel: () => void; onEnabled: (codes: string[]) => void;
}) {
  const { t, lang } = useLang();
  const auth = useAuth();
  const [qr, setQr] = useState<{ url: string; image: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    // Loaded here only: the QR encoder is not in the dashboard's main bundle.
    void import('qrcode').then((QRCode) => QRCode.toDataURL(otpauthUrl, { margin: 1, width: 200, errorCorrectionLevel: 'M' }))
      .then((image) => { if (live) setQr({ url: otpauthUrl, image }); });
    return () => { live = false; };
  }, [otpauthUrl]);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const code = String(new FormData(event.currentTarget).get('code') ?? '').trim();
    setBusy(true);
    setError(null);
    try {
      onEnabled((await auth.twoFactor.enable(code)).backupCodes);
    } catch (e) {
      const message = e instanceof ApiError && e.fields?.code ? e.fields.code[0] : authErrorMessage(e, t);
      setError(lang === 'ar' ? MESSAGE_AR.find(([p]) => p.test(message))?.[1] ?? message : message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title={t('اربط تطبيق المصادقة', 'Link your authenticator app')}>
      <div className="scan-grid">
        <div className="qr-box">
          {qr?.url === otpauthUrl
            // A generated data: URL — nothing for next/image to optimise or fetch.
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={qr.image} width={200} height={200} alt={t('رمز QR لإضافة الحساب إلى تطبيق المصادقة', 'QR code to add the account to your authenticator app')} />
            : <Loading rows={1} />}
        </div>
        <div>
          <ol className="scan-steps">
            <li>{t('افتح تطبيق المصادقة واختر إضافة حساب.', 'Open your authenticator app and choose to add an account.')}</li>
            <li>{t('امسح الرمز. أو أدخل هذا المفتاح يدويًا:', 'Scan the code. Or type this key in by hand:')}
              <code className="secret" dir="ltr">{secret.match(/.{1,4}/g)?.join(' ')}</code>
            </li>
            <li>{t('أدخل الرمز المكوّن من 6 أرقام الذي يظهر في التطبيق.', 'Enter the 6-digit code the app shows.')}</li>
          </ol>
          <form onSubmit={submit} noValidate style={{ maxWidth: 260 }}>
            <div className="field">
              <label htmlFor="sec-first-code">{t('رمز التحقق', 'Verification code')}</label>
              <input id="sec-first-code" name="code" dir="ltr" inputMode="numeric" autoComplete="one-time-code" maxLength={8} placeholder="123456" required aria-invalid={!!error} />
              {error && <span className="field-error">{error}</span>}
            </div>
            <div className="btn-row">
              <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? t('جارٍ التحقق…', 'Checking…') : t('فعّل', 'Turn on')}</button>
              <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={busy}>{t('إلغاء', 'Cancel')}</button>
            </div>
          </form>
        </div>
      </div>
    </Panel>
  );
}

/** AUTH-22: shown once. Each code signs in once when the phone is not at hand. */
function CodesStep({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  const { t } = useLang();
  const [copied, setCopied] = useState(false);
  const text = `${t('رموز الاستعداد — تجربة', 'Tajribah backup codes')}\n${t('كل رمز يعمل مرة واحدة.', 'Each code works once.')}\n\n${codes.join('\n')}\n`;
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'tajribah-backup-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  };
  const copy = async () => {
    try { await navigator.clipboard.writeText(codes.join('\n')); setCopied(true); } catch { /* the codes stay on screen to copy by hand */ }
  };
  return (
    <Panel title={t('احفظ رموز الاستعداد', 'Save your backup codes')} actions={<ShieldCheck size={20} aria-hidden style={{ color: 'var(--ok)' }} />}>
      <p style={{ marginTop: 0 }}>{t(
        'إن فقدت جوالك فهذه الرموز طريقك الوحيد للدخول. كل رمز يعمل مرة واحدة، ولن نعرضها مرة أخرى.',
        'If you lose your phone, these codes are your only way in. Each works once, and we will not show them again.',
      )}</p>
      <ul className="codes" dir="ltr">{codes.map((c) => <li key={c}>{c}</li>)}</ul>
      <div className="btn-row">
        <button type="button" className="btn btn-ghost" onClick={download}><Download size={15} aria-hidden />{t('تنزيل', 'Download')}</button>
        <button type="button" className="btn btn-ghost" onClick={copy}><Copy size={15} aria-hidden />{copied ? t('نُسخت', 'Copied') : t('نسخ', 'Copy')}</button>
        <button type="button" className="btn btn-primary" onClick={onDone}>{t('حفظتها', 'I have saved them')}</button>
      </div>
    </Panel>
  );
}
