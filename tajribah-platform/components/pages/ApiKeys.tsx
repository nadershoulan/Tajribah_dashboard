'use client';

// P8 — API keys: make one (named, scoped, with a lifetime), see it once, revoke it

import { useState, type FormEvent } from 'react';
import { Check, Copy, KeyRound, Lock } from 'lucide-react';
import { API_KEY_LIFETIMES, API_KEY_SCOPE_LABELS, API_KEY_SCOPES, type ApiKeyScope } from '@/lib/api-keys';
import { currentStore } from '@/lib/api-client';
import { AppLink } from '@/lib/app-env';
import { useAuth } from '@/lib/auth';
import { useData, useResource } from '@/lib/data';
import { formatDate, formatRelative } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { planByCode } from '@/lib/plans';
import type { ApiKeyView } from '@/lib/view-models';
import { Shell } from '@/components/dashboard/chrome';
import { Badge, Empty, ErrorNote, Loading, PageHead, Panel } from '@/components/dashboard/ui';
import { lockOf, useWriteLock } from '@/components/dashboard/write-lock';

const STATE: Record<ApiKeyView['state'], { tone: 'ok' | 'warn' | undefined; ar: string; en: string }> = {
  live: { tone: 'ok', ar: 'يعمل', en: 'Live' },
  expired: { tone: 'warn', ar: 'انتهت مدته', en: 'Expired' },
  revoked: { tone: undefined, ar: 'أُلغي', en: 'Revoked' },
};

export default function ApiKeys() {
  const { t } = useLang();
  const { me } = useAuth();
  const store = currentStore(me);
  const included = store ? planByCode(store.plan).features.includes('public_api') : false;
  const crumbs = [{ label: t('الرئيسية', 'Home'), href: '/dashboard' }, { label: t('الإعدادات', 'Settings'), href: '/dashboard/settings' }, { label: t('مفاتيح الواجهة البرمجية', 'API keys') }];

  return (
    <Shell tenant={null} crumbs={crumbs}>
      <PageHead
        title={t('مفاتيح الواجهة البرمجية', 'API keys')}
        lead={t(
          'مفاتيح لأنظمتك الأخرى — مستودع، نظام منتجات، لوحة تقارير — لتعمل على متجرك عبر الواجهة البرمجية، كلٌّ بما تسمح له به فقط.',
          'Keys for your other systems — a warehouse, a product system, a reporting board — to work with your store through the API, each with only what you allow it.',
        )}
      />
      {included ? <Keys /> : (
        <Panel>
          <Empty icon={<Lock size={22} aria-hidden />}
            title={t('ضمن باقة المؤسسات', 'Part of the Enterprise plan')}
            body={t('الواجهة البرمجية العامة ومفاتيحها متاحة في باقة المؤسسات.', 'The public API and its keys come with the Enterprise plan.')}
            action={<AppLink href="/dashboard/billing" className="btn btn-primary">{t('الباقات', 'Plans')}</AppLink>} />
        </Panel>
      )}
    </Shell>
  );
}

function Keys() {
  const { t, pick, lang } = useLang();
  const source = useData();
  const lock = useWriteLock();
  const { me } = useAuth();
  const staffView = lockOf(me) === 'staff_view'; // a read-only store may still revoke: a leaked key cannot wait
  const [version, setVersion] = useState(0);
  const { data, loading, error } = useResource((s) => s.apiKeys(), [version]);
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<ApiKeyScope[]>(['products:read']);
  const [lifetime, setLifetime] = useState<number | null>(90);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [made, setMade] = useState<{ key: string; name: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setProblem(null);
    try {
      const result = await source.createApiKey({ name: name.trim(), scopes, expiresInDays: lifetime });
      setMade({ key: result.key, name: result.apiKey.name });
      setCopied(false);
      setName('');
      setVersion((v) => v + 1);
    } catch (err) { setProblem((err as Error).message); } finally { setBusy(false); }
  };
  const revoke = async (id: string) => {
    setBusy(true); setProblem(null);
    try { await source.revokeApiKey(id); setConfirming(null); setVersion((v) => v + 1); } catch (err) { setProblem((err as Error).message); } finally { setBusy(false); }
  };
  const copy = async () => {
    if (!made) return;
    try { await navigator.clipboard.writeText(made.key); setCopied(true); } catch { /* clipboard blocked; the key can still be selected */ }
  };
  const lifetimeLabel = (days: number | null) => (days === null ? t('حتى تلغيه', 'Until you revoke it') : t(`${days} يومًا`, `${days} days`));

  return (
    <>
      {made && (
        <Panel title={t(`المفتاح «${made.name}»`, `The key “${made.name}”`)}
          sub={t('انسخه الآن واحفظه في مكان آمن — لن يظهر مرة أخرى. إن ضاع، ألغِه واصنع غيره.', 'Copy it now and keep it somewhere safe — it will not be shown again. If it is lost, revoke it and make another.')}>
          <pre className="code-block" dir="ltr" aria-label={t('المفتاح', 'The key')}>{made.key}</pre>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => void copy()}>
              {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}{copied ? t('نُسخ', 'Copied') : t('انسخ المفتاح', 'Copy the key')}
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setMade(null)}>{t('حفظته', 'I have saved it')}</button>
            <span className="hint" style={{ margin: 0 }} dir="ltr">Authorization: Bearer {made.key.slice(0, 12)}…</span>
          </div>
        </Panel>
      )}

      <Panel title={t('مفتاح جديد', 'New key')}>
        <form className="key-form" onSubmit={create}>
          <label className="field">
            <span>{t('الاسم', 'Name')}</span>
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t('مثلًا: مزامنة المستودع', 'e.g. Warehouse sync')} />
          </label>
          <fieldset>
            <legend>{t('ما يسمح له به', 'What it may do')}</legend>
            {API_KEY_SCOPES.map((scope) => (
              <label key={scope} className="toggle">
                <input type="checkbox" checked={scopes.includes(scope)} onChange={(e) => setScopes((s) => (e.target.checked ? [...s, scope] : s.filter((x) => x !== scope)))} />
                <span>{pick(API_KEY_SCOPE_LABELS[scope])}</span>
              </label>
            ))}
          </fieldset>
          <label className="field">
            <span>{t('المدة', 'Lifetime')}</span>
            <select value={lifetime === null ? 'none' : String(lifetime)} onChange={(e) => setLifetime(e.target.value === 'none' ? null : Number(e.target.value))}>
              {API_KEY_LIFETIMES.map((days) => <option key={String(days)} value={days === null ? 'none' : String(days)}>{lifetimeLabel(days)}</option>)}
            </select>
          </label>
          <p className="hint">{t('يعمل المفتاح باسمك وبصلاحياتك داخل ما اخترته: إن غادرت المتجر توقف.', 'The key works as you, within what you chose: if you leave the store, it stops.')}</p>
          <button type="submit" className="btn btn-primary btn-sm" disabled={busy || lock.locked || !name.trim() || !scopes.length} title={lock.title}>
            <KeyRound size={14} aria-hidden />{busy ? t('جارٍ الإنشاء…', 'Making…') : t('أنشئ المفتاح', 'Make the key')}
          </button>
          {problem && <p className="field-error" role="alert">{problem}</p>}
        </form>
      </Panel>

      <Panel flush title={t('المفاتيح', 'Keys')}>
        {loading && !data && <Loading rows={3} />}
        {error && <ErrorNote error={error} />}
        {data && data.length === 0 && (
          <p className="hint" style={{ margin: 18 }}>{t('لا مفاتيح بعد.', 'No keys yet.')}</p>
        )}
        {data && data.length > 0 && (
          <ul className="job-list">
            {data.map((key) => (
              <li key={key.id}>
                <div className="job-main">
                  <strong>{key.name}</strong>
                  <code className="job-product" dir="ltr">{key.prefix}…</code>
                  <Badge tone={STATE[key.state].tone}>{pick(STATE[key.state])}</Badge>
                </div>
                <p className="hint" style={{ margin: '6px 0 0' }}>{key.scopes.map((s) => (s in API_KEY_SCOPE_LABELS ? pick(API_KEY_SCOPE_LABELS[s as ApiKeyScope]) : s)).join(t('، ', ', '))}</p>
                <div className="job-meta hint">
                  <span>{t('أنشأه', 'Made by')} {key.createdBy ?? t('عضو سابق', 'a former member')} · {formatDate(key.createdAt, lang)}</span>
                  <span>{key.lastUsedAt ? t(`آخر استخدام ${formatRelative(key.lastUsedAt, lang)}`, `Last used ${formatRelative(key.lastUsedAt, lang)}`) : t('لم يُستخدم', 'Never used')}</span>
                  {key.state === 'live' && <span>{key.expiresAt ? t(`ينتهي ${formatDate(key.expiresAt, lang)}`, `Expires ${formatDate(key.expiresAt, lang)}`) : t('بلا نهاية', 'No expiry')}</span>}
                  {key.state === 'live' && (confirming === key.id
                    ? <span className="confirm-inline" role="alertdialog" aria-label={t('إلغاء المفتاح', 'Revoke the key')}>
                        {t('إلغاؤه يوقف كل ما يستخدمه فورًا.', 'Revoking stops everything that uses it, at once.')}{' '}
                        <button type="button" className="btn btn-danger btn-sm" onClick={() => void revoke(key.id)} disabled={busy}>{t('نعم، ألغِه', 'Yes, revoke')}</button>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirming(null)} disabled={busy}>{t('تراجع', 'Keep it')}</button>
                      </span>
                    : <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirming(key.id)} disabled={busy || staffView} title={staffView ? lock.title : undefined}>{t('ألغِ', 'Revoke')}</button>)}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
