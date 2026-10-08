'use client';

/**
 * T69 — a GA4 measurement id: pasted, or picked after signing in with Google. Used for the website
 * (staff console) and for a store's own products' pages (Store settings).
 *
 * Google sends the browser back to the screen that started it with `#ga4=<ticket>` (the web streams
 * found) or `#ga4_error=<why>`; the fragment is read once and cleared, so a reload does not repeat it.
 * Picking a stream only fills the field — the screen's own save keeps it.
 */
import { useEffect, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import type { Ga4Picker, Ga4Stream } from '@/lib/contracts/settings';
import { sayProblem } from '@/lib/problem-text';
import { useLang } from '@/lib/i18n';

const WHY: Record<string, { ar: string; en: string }> = {
  denied: { ar: 'أُلغي تسجيل الدخول في Google.', en: 'The Google sign-in was cancelled.' },
  scope: { ar: 'لم يُسمح بقراءة Google Analytics — سجّل الدخول مرة أخرى واترك الإذن مفعّلًا.', en: 'Reading Google Analytics was not allowed — sign in again and leave that permission ticked.' },
  none: { ar: 'لا يوجد في هذا الحساب مصدر بيانات ويب في GA4. أنشئ واحدًا في Google Analytics أو الصق المعرّف.', en: 'This account has no GA4 web data stream. Create one in Google Analytics, or paste the id.' },
  // T121: creating an account for someone who had none.
  tos: { ar: 'لم تُقبل شروط Google Analytics، فلم يُنشأ الحساب. حاول مرة أخرى واقبل الشروط في صفحة Google.', en: 'The Google Analytics terms were not accepted, so no account was created. Try again and accept them on Google’s page.' },
  create: { ar: 'تعذّر إنشاء حساب Google Analytics الآن — حاول بعد قليل أو أنشئه في Google Analytics والصق المعرّف.', en: 'The Google Analytics account could not be created just now — try again shortly, or create it in Google Analytics and paste the id.' },
  state: { ar: 'انتهت مهلة تسجيل الدخول أو بدأ من متصفح آخر — حاول مرة أخرى.', en: 'The sign-in expired or started in another browser — try again.' },
  setup: { ar: 'إعداد تسجيل الدخول بـ Google لدينا غير مكتمل — الصق المعرّف الآن.', en: 'Our Google sign-in is not set up correctly — paste the id for now.' },
  code: { ar: 'لم يقبل Google تسجيل الدخول — حاول مرة أخرى.', en: 'Google did not accept the sign-in — try again.' },
  unavailable: { ar: 'تعذّر الوصول إلى Google الآن — حاول بعد قليل أو الصق المعرّف.', en: 'Google could not be reached — try again shortly, or paste the id.' },
};

/** Read and clear `#ga4=…` / `#ga4_error=…` once, on the screen Google returned to. */
function takeFragment(): { ticket: string | null; error: string | null } {
  if (typeof window === 'undefined') return { ticket: null, error: null };
  const hash = new URLSearchParams(window.location.hash.slice(1));
  const ticket = hash.get('ga4');
  const error = hash.get('ga4_error');
  if (ticket || error) window.history.replaceState(null, '', window.location.pathname + window.location.search);
  return { ticket, error };
}

export function Ga4Field({ id, value, onChange, error, picker, hint, disabled }: {
  id: string; value: string; onChange: (value: string) => void; error?: string; picker: Ga4Picker; hint?: string; disabled?: boolean;
}) {
  const { t, lang } = useLang();
  const [available, setAvailable] = useState(false);
  const [streams, setStreams] = useState<Ga4Stream[] | null>(null);
  // Read once, on the first render after Google sent the browser back.
  const [arrival] = useState(takeFragment);
  const [problem, setProblem] = useState<string | null>(() => (arrival.error ? (WHY[arrival.error] ?? WHY.unavailable!)[lang] : null));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let live = true;
    picker.available().then((yes) => { if (live) setAvailable(yes); }, () => {});
    const { ticket } = arrival;
    if (ticket) {
      picker.streams(ticket).then((found) => {
        if (!live) return;
        setStreams(found);
        // One stream (or the one just created): fill it in; the screen's save keeps it.
        if (found.length === 1) onChange(found[0]!.measurementId);
      }, (e: Error) => { if (live) setProblem(e.message); });
    }
    return () => { live = false; };
    // Once, on arrival: the fragment is gone after the first read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picker, arrival]);

  const signIn = async () => {
    setBusy(true); setProblem(null);
    try { window.location.assign(await picker.start()); } catch (e) { setProblem(sayProblem(e, lang)); setBusy(false); }
  };

  return (
    <div className="field">
      <label htmlFor={id}>{t('معرّف القياس في GA4', 'GA4 measurement id')}</label>
      <input id={id} dir="ltr" value={value} placeholder="G-XXXXXXXXXX" maxLength={20} autoComplete="off" spellCheck={false} disabled={disabled}
        onChange={(e) => onChange(e.target.value)} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : `${id}-hint`} />
      {error
        ? <span id={`${id}-error`} className="field-error">{lang === 'ar' && /measurement id/.test(error) ? 'معرّف GA4 بصيغة ‎G-AB12CD34EF' : error}</span>
        : <span id={`${id}-hint`} className="field-hint">{hint ?? t('من Google Analytics: المسؤول ← مصادر البيانات ← الويب. اتركه فارغًا لإيقافه.', 'From Google Analytics: Admin → Data streams → Web. Leave it blank to switch it off.')}</span>}

      {available && (
        <div style={{ marginTop: 10 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={signIn} disabled={busy || disabled}>
            <ExternalLink size={14} aria-hidden />{busy ? t('جارٍ الفتح…', 'Opening…') : t('املأه بتسجيل الدخول بـ Google', 'Fill it by signing in with Google')}
          </button>
          <p className="hint" style={{ margin: '6px 0 0' }}>{t('نعرض مصادر بياناتك في Google Analytics لتختار منها. ليس لديك حساب؟ ننشئه لك بعد موافقتك على شروط Google، ونملأ المعرّف تلقائيًا. لا نحتفظ بأي شيء من حسابك.', 'We list your Google Analytics data streams for you to pick from. No account yet? We create one once you accept Google’s terms, and fill in the id for you. We keep nothing from your account.')}</p>
        </div>
      )}

      {problem && <p className="field-error" role="alert" style={{ margin: '8px 0 0' }}>{problem}</p>}

      {streams && streams.length > 0 && (
        <fieldset className="ga4-streams" style={{ border: 0, padding: 0, margin: '10px 0 0' }}>
          <legend className="hint" style={{ marginBottom: 6 }}>{t('مصادر بيانات الويب في حسابك — اختر واحدًا ثم احفظ:', 'Web data streams in your account — pick one, then save:')}</legend>
          {streams.map((s) => (
            <label key={s.measurementId} className="toggle" style={{ display: 'flex', gap: 8, alignItems: 'flex-start', marginBottom: 6 }}>
              <input type="radio" name={`${id}-stream`} checked={value.trim().toUpperCase() === s.measurementId} onChange={() => onChange(s.measurementId)} />
              <span>
                <span dir="ltr" className="mm">{s.measurementId}</span> — {s.stream}
                <span className="hint" style={{ display: 'block', margin: 0 }}>{[s.account, s.property].filter(Boolean).join(' · ')}{s.url ? <> · <span dir="ltr">{s.url}</span></> : null}</span>
              </span>
            </label>
          ))}
        </fieldset>
      )}
    </div>
  );
}
