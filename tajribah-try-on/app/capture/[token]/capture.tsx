'use client';

import { useEffect, useRef, useState } from 'react';
import { Camera, Check, Globe, Hand, LoaderCircle, Upload } from 'lucide-react';
import { preparePhoto } from '@/lib/photo';
import { useLang } from '@/lib/i18n';
import { Logo } from '@/components/site/chrome';
import { Frame } from '@/components/site/ui';
import { SiteLink } from '@/lib/site-env';

/** The phone side of the QR hand-off: take a wrist photo, send it to the paired studio. */
export default function Capture({ token }: { token: string }) {
  const { t, toggle } = useLang();
  const [photo, setPhoto] = useState<{ blob: Blob; dataUrl: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [valid, setValid] = useState<boolean | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let live = true;
    fetch(`/api/pair/${token}`, { cache: 'no-store' })
      .then((r) => { if (live) setValid(r.ok); })
      .catch(() => { if (live) { setValid(false); setError(t('تعذّر الاتصال. امسح رمزًا جديدًا.', 'Could not connect. Please scan a new code.')); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function choose(f: File) {
    setBusy(true); setError('');
    try { setPhoto(await preparePhoto(f)); }
    catch { setError(t('تعذّر فتح الصورة. اختر JPG أو PNG أو WebP أقل من 20 ميجابايت.', 'This photo could not be opened. Choose a JPG, PNG or WebP under 20 MB.')); }
    finally { setBusy(false); }
  }
  async function send() {
    if (!photo) return;
    setBusy(true); setError('');
    try {
      const r = await fetch(`/api/pair/${token}`, { method: 'POST', headers: { 'Content-Type': 'image/jpeg' }, body: photo.blob });
      if (!r.ok) throw Error(((await r.json()) as { error: string }).error);
      setSent(true); setPhoto(null);
    } catch (e) {
      setError(e instanceof Error && e.message ? e.message : t('تعذّر الإرسال. حاول مجددًا.', 'Could not send. Try again.'));
    } finally { setBusy(false); }
  }

  return (
    <main className="capture-page">
      <header>
        <Logo />
        <button className="lang-btn" onClick={toggle}><Globe size={16} aria-hidden />{t('English', 'العربية')}</button>
      </header>
      <section className="capture-card">
        {valid === null ? <LoaderCircle className="spin" /> : !valid ? (
          <>
            <h1>{t('لنعاود الاتصال', 'Let’s reconnect')}</h1>
            <p>{t('هذه الجلسة لم تعد متاحة. افتح «عليّ» على الشاشة الأخرى وامسح رمزًا جديدًا.', 'This QR session is no longer available. Open “On me” on your other screen and scan a new code.')}</p>
          </>
        ) : sent ? (
          <>
            <div className="photo-icon"><Check size={31} /></div>
            <h1>{t('صورتك في الطريق', 'Your photo is on its way')}</h1>
            <p>{t('عُد إلى شاشتك الأخرى لترى الساعة على معصمك. يمكنك إغلاق هذه الصفحة.', 'Go back to your other screen to see the watch on your wrist. You can close this page.')}</p>
          </>
        ) : (
          <>
            <span className="eyebrow">{t('تجربتك الخاصة', 'Your personal try-on')}</span>
            <h1>{t('شاهدها عليك', 'Picture it on you')}</h1>
            <p>{t('صوّر ظهر يدك ومعصمك في إضاءة جيدة، وأظهر أصابعك وجزءًا من ساعدك داخل الصورة.', 'Photograph the back of your hand and wrist in good light. Keep your fingers and part of your forearm in the frame.')}</p>
            {photo ? <img className="capture-photo" src={photo.dataUrl} alt={t('صورة معصمك', 'Your wrist photo')} /> : (
              <Frame className="capture-example">
                <Hand size={64} strokeWidth={1.2} aria-hidden />
                <span>{t('أظهر اليد كاملة في الصورة', 'Keep your whole hand in the photo')}</span>
              </Frame>
            )}
            <button className="primary-button" disabled={busy} onClick={() => (photo ? void send() : input.current?.click())}>
              {busy ? <LoaderCircle className="spin" size={18} /> : <Camera size={18} />} {photo ? t('أرسل إلى الاستوديو', 'Send to my studio') : t('التقط صورة', 'Take a photo')}
            </button>
            <button className="text-button" disabled={busy} onClick={() => gallery.current?.click()}>
              <Upload size={15} />{photo ? t('اختر صورة أخرى', 'Choose a different photo') : t('اختر من الصور', 'Choose from photos')}
            </button>
            <p className="privacy-note">
              {t('تُرسل الصورة إلى الاستوديو المقترن فقط، وتُحذف فور استلامها أو بعد 30 دقيقة.', 'Your photo goes only to your paired studio and is deleted when received, or after 30 minutes.')}{' '}
              <SiteLink href="/try-on-privacy">{t('التفاصيل', 'Details')}</SiteLink>
            </p>
          </>
        )}
        {error && <p className="capture-error" role="alert">{error}</p>}
      </section>
      <input className="sr-only" ref={input} type="file" capture="environment" accept="image/*" onChange={(e) => { const f = e.target.files?.[0]; if (f) void choose(f); e.target.value = ''; }} />
      <input className="sr-only" ref={gallery} type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) void choose(f); e.target.value = ''; }} />
    </main>
  );
}
