'use client';

// A15 — Website: the website's own settings — its GA4 measurement id (T69)

import { useEffect, useState } from 'react';
import { useAuth, type AdminSiteSettings } from '@/lib/auth';
import { ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useLang } from '@/lib/i18n';
import { AdminShell } from '@/components/admin/shell';
import { ErrorNote, Loading, Panel } from '@/components/dashboard/ui';
import { Ga4Field } from '@/components/dashboard/ga4-field';

export default function AdminSite() {
  const { t } = useLang();
  return <AdminShell title={t('الموقع', 'Website')}><Site /></AdminShell>;
}

function Site() {
  const { t, lang } = useLang();
  const auth = useAuth();
  const [settings, setSettings] = useState<AdminSiteSettings | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [id, setId] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [fieldError, setFieldError] = useState<string | undefined>();
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    auth.admin.site().then((s) => { if (live) { setSettings(s); setId((current) => current || s.ga4MeasurementId || ''); } }, (e: Error) => { if (live) setError(e); });
    return () => { live = false; };
  }, [auth.admin]);

  if (error) return <ErrorNote error={error} />;
  if (!settings) return <Panel><Loading rows={3} /></Panel>;

  const changed = id.trim().toUpperCase() !== (settings.ga4MeasurementId ?? '');
  const ready = changed && reason.trim().length >= 5;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ready) return;
    setBusy(true); setProblem(null); setFieldError(undefined); setNotice(null);
    try {
      const saved = await auth.admin.updateSite({ ga4MeasurementId: id.trim() || null, reason: reason.trim() });
      setSettings(saved); setId(saved.ga4MeasurementId ?? ''); setReason('');
      setNotice(saved.ga4MeasurementId
        ? t('حُفظ. يظهر شريط الموافقة على الموقع خلال دقائق، ولا يُحمَّل Google Analytics إلا بعد موافقة الزائر.', 'Saved. The website shows its consent banner within minutes; Google Analytics loads only after a visitor agrees.')
        : t('أُوقف. يتوقف الموقع عن تحميل Google Analytics خلال دقائق.', 'Switched off. The website stops loading Google Analytics within minutes.'));
    } catch (err) {
      if (err instanceof ApiError && err.fields?.ga4MeasurementId) setFieldError(err.fields.ga4MeasurementId[0]);
      else setProblem((err as Error).message);
    } finally { setBusy(false); }
  };

  return (
    <div className="ops">
      {notice && <p role="status" className="plan-notice">{notice}</p>}
      <Panel title={t('Google Analytics للموقع', 'Website Google Analytics')}
        sub={t('موقع تجربة (tajribah.sa) — ليس صفحات المتاجر. شريط موافقة بالعربية أولًا، والإعلانات مرفوضة دائمًا.', 'The Tajribah website (tajribah.sa) — not stores’ pages. An Arabic-first consent banner; advertising always denied.')}>
        <form onSubmit={save} noValidate>
          <Ga4Field id="site-ga4" value={id} onChange={(v) => { setId(v); setNotice(null); }} error={fieldError} picker={auth.admin.ga4Picker} />
          <p className="hint" style={{ marginTop: 0 }}>
            {settings.ga4MeasurementId
              ? <>{t('المفعّل الآن', 'Live now')}: <span dir="ltr" className="mm">{settings.ga4MeasurementId}</span>{settings.updatedAt ? <> · {formatDateTime(settings.updatedAt, lang)}</> : null}</>
              : t('غير مفعّل: لا شريط موافقة ولا تحليلات، وسياسة الخصوصية تقول إنه لا توجد تحليلات.', 'Off: no consent banner, no analytics, and the privacy policy says there is none.')}
          </p>
          <div className="admin-actions">
            <div className="field act-reason"><label htmlFor="site-reason">{t('السبب', 'Reason')}</label><input id="site-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder={t('مثال: أُنشئت خاصية الموقع في GA4', 'e.g. the website’s GA4 property is ready')} /></div>
            <div className="btn-row">
              <button type="submit" className="btn btn-accent" disabled={busy || !ready}>{id.trim() ? t('احفظ وانشر', 'Save and publish') : t('أوقف التحليلات', 'Switch analytics off')}</button>
            </div>
          </div>
          {problem && <p className="field-error" role="alert" style={{ margin: '8px 0 0' }}>{t('لم يُحفظ: ', 'Not saved: ')}<span dir="ltr">{problem}</span></p>}
        </form>
      </Panel>
    </div>
  );
}
