'use client';

/**
 * T135 — a product set to "on the phone only", seen on a computer: no model photos — a QR code to continue on the
 * phone, where the camera try-on opens (Tangiblee's way, Nader's recording). The code is a pairing like the studio's
 * (`/api/pair`; the product and store are read on the server from this frame's own store and product); when the
 * shopper sends a photo from the phone, it shows here with the product where they left it (T134.7), and a new code
 * can be made for another.
 */
import { useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw, Smartphone } from 'lucide-react';
import { useLang } from '@site/lib/i18n';
import { useSiteEnv } from '@site/lib/site-env';
import { QR_MARK, markedQrPng } from '@/lib/qr-mark';
import { kindOf } from '@site/lib/pair-product';
import { POSE_HEADER, poseFromHeader, type SharedPose } from '@site/lib/pair-pose';
import { cssShadow, type ShadowKind } from '@site/lib/shadow';
import type { TryOnProduct } from '@site/lib/demo-product';

const SHADOW: Record<string, ShadowKind> = { watch: 'watch', ring: 'ring', bag: 'bag', glasses: 'eyewear', necklace: 'necklace', earring: 'earring' };
type Received = { src: string; width: number; height: number; pose: SharedPose | null };

export default function PhoneQr({ product }: { product: TryOnProduct }) {
  const { t } = useLang();
  const { asset } = useSiteEnv();
  const kind = kindOf(product);
  const [pair, setPair] = useState<{ id: string; expiresAt: number } | null>(null);
  const [qr, setQr] = useState('');
  const [failed, setFailed] = useState(false);
  const [received, setReceived] = useState<Received | null>(null);
  const [round, setRound] = useState(0);
  const [aspect, setAspect] = useState(1);
  const worn = asset(product.worn);

  useEffect(() => {
    const img = new Image();
    img.onload = () => { if (img.naturalWidth) setAspect(img.naturalHeight / img.naturalWidth); };
    img.src = worn;
  }, [worn]);

  // a pairing and its code (again for another photo, or when one expires)
  useEffect(() => {
    let live = true;
    setPair(null); setQr(''); setFailed(false);
    (async () => {
      try {
        const r = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, ...(product.demo ? { demo: product.sku } : {}) }) });
        if (!r.ok) throw Error();
        const p = (await r.json()) as { id: string; expiresAt: number };
        const png = await markedQrPng(`${location.origin}/capture/${p.id}`, 480, `${location.origin}${QR_MARK}`, { dark: '#0A2237', light: '#ffffff' });
        if (live) { setPair(p); setQr(png); }
      } catch { if (live) setFailed(true); }
    })();
    return () => { live = false; };
  }, [kind, product.demo, product.sku, round]);

  // the phone's photo, when the shopper sends it
  useEffect(() => {
    if (!pair) return;
    let done = false, pending = false;
    const timer = setInterval(async () => {
      if (done || pending) return;
      pending = true;
      try {
        if (Date.now() > pair.expiresAt) { clearInterval(timer); setRound((n) => n + 1); return; }
        const r = await fetch(`/api/pair/${pair.id}`, { cache: 'no-store' });
        if (!r.ok) throw Error();
        if (!((await r.json()) as { ready: boolean }).ready) return;
        clearInterval(timer);
        const photo = await fetch(`/api/pair/${pair.id}?image=1`, { cache: 'no-store' });
        if (!photo.ok) throw Error();
        const pose = poseFromHeader(photo.headers.get(POSE_HEADER));
        const src = URL.createObjectURL(await photo.blob());
        const img = new Image();
        img.onload = () => { if (!done) setReceived({ src, width: img.naturalWidth, height: img.naturalHeight, pose }); };
        img.src = src;
        void fetch(`/api/pair/${pair.id}`, { method: 'DELETE' });
      } catch { /* try again on the next tick */ } finally { pending = false; }
    }, 2500);
    return () => { done = true; clearInterval(timer); };
  }, [pair]);

  const name = t(product.name.ar, product.name.en);
  if (received) {
    const box = 560, f = Math.min(box / received.width, box / received.height);
    const w = received.width * f, h = received.height * f;
    const p = received.pose;
    const pw = p ? p.width * received.width * f : 0;
    return (
      <div className="pq">
        <div className="pq-photo" style={{ width: w, height: h }}>
          <img src={received.src} alt={t('صورتك من جوالك', 'Your photo from your phone')} />
          {p && (
            <div className="pq-placed" style={{ filter: cssShadow(SHADOW[kind] ?? 'watch', pw) }}>
              <img src={worn} alt={name} data-pose={`${Math.round(p.x * w)},${Math.round(p.y * h)},${Math.round(pw)},${Math.round(p.angle)}`}
                style={{ left: p.x * w - pw / 2, top: p.y * h - (pw * aspect) / 2, width: pw, height: pw * aspect, transform: `rotate(${p.angle}deg)` }} />
            </div>
          )}
        </div>
        <button type="button" className="primary-button" onClick={() => { setReceived(null); setRound((n) => n + 1); }}><RefreshCw size={16} /> {t('صورة أخرى من جوالك', 'Another photo from your phone')}</button>
      </div>
    );
  }
  return (
    <div className="pq">
      <img className="pq-product" src={worn} alt={name} />
      <h2>{t('جرّبها عليك بجوالك', 'Try it on with your phone')}</h2>
      <p>{kind === 'glasses' || kind === 'necklace' || kind === 'earring'
        ? t('امسح الرمز بكاميرا جوالك: تفتح التجربة بالكاميرا مباشرة وتراها عليك.', 'Scan the code with your phone’s camera: the try-on opens on the camera and you see it on you.')
        : t('امسح الرمز بكاميرا جوالك: تفتح التجربة بالكاميرا مباشرة وتراها على يدك.', 'Scan the code with your phone’s camera: the try-on opens on the camera and you see it on your hand.')}</p>
      <div className="pq-code">
        {failed ? <button type="button" className="primary-button" onClick={() => setRound((n) => n + 1)}><RefreshCw size={16} /> {t('حاول مجددًا', 'Try again')}</button>
          : qr ? <img src={qr} alt={t('امسح الرمز بجوالك', 'Scan the code with your phone')} /> : <LoaderCircle className="spin" />}
      </div>
      <p className="pq-hint"><Smartphone size={15} aria-hidden /> {t('يمكنك إرسال صورتك من جوالك لتظهر هنا.', 'You can send your photo from your phone to show here.')}</p>
    </div>
  );
}
