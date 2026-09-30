'use client';

// MD-171 — Single sign-on (P8, Enterprise): the store's own identity provider

import { useState, type FormEvent } from 'react';
import { KeyRound } from 'lucide-react';
import { currentStore, type ApiError } from '@/lib/api-client';
import { AppLink } from '@/lib/app-env';
import { useAuth } from '@/lib/auth';
import { useData, useResource } from '@/lib/data';
import { formatDateTime } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { planByCode } from '@/lib/plans';
import type { SsoSettingsView } from '@/lib/view-models';
import { useWriteLock } from '@/components/dashboard/write-lock';
import { Badge, ErrorNote, Loading, Panel } from '@/components/dashboard/ui';

/**
 * Owners and admins connect the store's provider (Microsoft Entra, Google Workspace, Okta…). Its people
 * then sign in from the store's own sign-in address — members only, and only into this store.
 */
export function SsoPanel() {
  const { t } = useLang();
  const { me } = useAuth();
  const store = currentStore(me);
  const included = store ? planByCode(store.plan).features.includes('sso') : false;
  const { data, loading, error } = useResource((source) => source.ssoSettings(), []);
  const [saved, setSaved] = useState<SsoSettingsView | null>(null);
  const view = saved ?? data;

  return (
    <Panel title={t('تسجيل الدخول الموحّد', 'Single sign-on')}
      sub={t('يدخل فريقك بحساب شركتكم (Microsoft أو Google أو Okta) بدل كلمة مرور تجربة.', 'Your team signs in with your company account (Microsoft, Google, Okta) instead of a Tajribah password.')}>
      {!included ? (
        <p className="hint" style={{ margin: 0 }}>
          {t('ضمن باقة المؤسسات.', 'Included in the Enterprise plan.')} <AppLink href="/dashboard/billing" style={{ color: 'var(--aqua)' }}>{t('الباقات', 'Plans')}</AppLink>
        </p>
      ) : error ? <ErrorNote error={error} /> : !view ? (loading ? <Loading rows={3} /> : null) : (
        <SsoForm key={view.updatedAt ?? 'new'} view={view} canEdit={store?.role === 'owner' || store?.role === 'admin'} onSaved={setSaved} />
      )}
    </Panel>
  );
}

function SsoForm({ view, canEdit, onSaved }: { view: SsoSettingsView; canEdit: boolean; onSaved: (v: SsoSettingsView) => void }) {
  const { t, lang } = useLang();
  const source = useData();
  const lock = useWriteLock();
  const [form, setForm] = useState({ issuer: view.issuer ?? '', clientId: view.clientId ?? '', clientSecret: '', domains: view.emailDomains.join(', '), enabled: view.enabled });
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const set = (key: 'issuer' | 'clientId' | 'clientSecret' | 'domains') => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setProblem(null);
    try {
      onSaved(await source.saveSsoSettings({
        issuer: form.issuer.trim(), clientId: form.clientId.trim(), clientSecret: form.clientSecret.trim() || null,
        emailDomains: form.domains.split(/[\s,،]+/).filter(Boolean), enabled: form.enabled,
      }));
    } catch (err) {
      const fields = (err as ApiError & { fields?: Record<string, string[]> }).fields;
      setProblem(fields ? Object.entries(fields).map(([k, v]) => `${label(k)}: ${v.join(', ')}`).join(' · ') : (err as Error).message);
      setBusy(false);
    }
  };
  const label = (key: string) => ({ issuer: t('عنوان المزوّد', 'Issuer'), clientId: t('معرّف التطبيق', 'Client ID'), clientSecret: t('السر', 'Client secret'), emailDomains: t('النطاقات', 'Domains') }[key] ?? key);

  return (
    <form className="guardrails-form sso-form" onSubmit={save} style={{ maxWidth: 640 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
        {view.enabled ? <Badge tone="ok" dot>{t('يعمل', 'On')}</Badge> : <Badge>{view.configured ? t('متوقف', 'Off') : t('غير مُعد', 'Not set up')}</Badge>}
        {view.updatedAt && <span className="hint" style={{ margin: 0 }}>{t('آخر تغيير', 'Last changed')} {formatDateTime(view.updatedAt, lang)}</span>}
      </div>
      <p className="hint" style={{ margin: '0 0 6px' }}>{t('في مزوّدكم، أضيفوا تطبيق OpenID Connect بعنوان الرجوع هذا:', 'At your provider, add an OpenID Connect app with this redirect address:')}</p>
      <code dir="ltr" className="sso-copy">{view.redirectUri}</code>
      <label className="field"><span>{t('عنوان المزوّد (Issuer)', 'Issuer URL')}</span>
        <input dir="ltr" inputMode="url" value={form.issuer} onChange={set('issuer')} placeholder="https://login.microsoftonline.com/…/v2.0" disabled={!canEdit} maxLength={500} /></label>
      <label className="field"><span>{t('معرّف التطبيق (Client ID)', 'Client ID')}</span>
        <input dir="ltr" value={form.clientId} onChange={set('clientId')} disabled={!canEdit} maxLength={300} /></label>
      <label className="field"><span>{t('السر (Client secret)', 'Client secret')}</span>
        <input dir="ltr" type="password" autoComplete="new-password" value={form.clientSecret} onChange={set('clientSecret')} disabled={!canEdit} maxLength={1000}
          placeholder={view.configured ? t('محفوظ — اتركه فارغًا لإبقائه', 'Saved — leave empty to keep it') : ''} /></label>
      <label className="field"><span>{t('نطاقات البريد المسموحة (اختياري)', 'Allowed email domains (optional)')}</span>
        <input dir="ltr" value={form.domains} onChange={set('domains')} placeholder="bigco.sa" disabled={!canEdit} /></label>
      <label className="toggle" style={{ margin: '4px 0 10px' }}>
        <input type="checkbox" checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} disabled={!canEdit} />
        <span>{t('شغّل تسجيل الدخول الموحّد', 'Turn single sign-on on')}</span>
      </label>
      <p className="hint" style={{ margin: '0 0 10px' }}>{t(
        'يدخل به أعضاء المتجر فقط (ادعُهم من الفريق أولًا)، وإلى هذا المتجر وحده. يبقى دخولهم بكلمة المرور كما هو.',
        'Only members of this store can use it (invite them from Team first), and it opens this store alone. Their password sign-in stays as it is.')}</p>
      {view.enabled && (
        <p className="hint" style={{ margin: '0 0 10px' }}>{t('يدخل فريقك من:', 'Your team signs in at:')} <code dir="ltr" className="sso-copy">{view.signInUrl}</code></p>
      )}
      {canEdit ? (
        <button type="submit" className="btn btn-primary btn-sm" style={{ justifySelf: 'start' }} disabled={busy || lock.locked || !form.issuer.trim() || !form.clientId.trim()} title={lock.title}>
          <KeyRound size={15} aria-hidden />{busy ? t('جارٍ الحفظ…', 'Saving…') : t('احفظ', 'Save')}
        </button>
      ) : <p className="hint" style={{ margin: 0 }}>{t('يغيّره المالك أو المدير.', 'The owner or an admin changes this.')}</p>}
      {problem && <p className="field-error" role="alert">{problem}</p>}
    </form>
  );
}
