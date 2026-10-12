'use client';

/**
 * T135 — a product set to "on the phone only", seen on a computer: no model photos — a QR code to continue on the
 * phone, where the camera try-on opens (Tangiblee's way, Nader's recording). The code is a pairing like the studio's
 * (`/api/pair`; the product and store are read on the server from this frame's own store and product); when the
 * shopper sends a photo from the phone, it shows here with the product where they left it (T134.7). T139: the phone may
 * send several in the same pairing — each arrives as one more of the shopper's photos, to switch between here.
 */
import { useEffect, useState } from 'react';
import { LoaderCircle, RefreshCw, Smartphone } from 'lucide-react';
import { useLang } from '@site/lib/i18n';
import { useSiteEnv } from '@site/lib/site-env';
import { QR_MARK, markedQrPng } from '@/lib/qr-mark';
import { kindOf } from '@site/lib/pair-product';
import { poseFromHeader, type SharedPose } from '@site/lib/pair-pose';
import { nextPhoto } from '@site/lib/pair-photos';
import { cssShadow, type ShadowKind } from '@site/lib/shadow';
import type { TryOnProduct } from '@site/lib/demo-product';

const SHADOW: Record<string, ShadowKind> = { watch: 'watch', ring: 'ring', bag: 'bag', glasses: 'eyewear', necklace: 'necklace', earring: 'earring' };
type Received = { id: number; src: string; width: number; height: number; pose: SharedPose | null };
/** T139: the photos kept to switch between (the oldest goes first). */
const MAX_RECEIVED = 8;

export default function PhoneQr({ product, mark = QR_MARK }: { product: TryOnProduct; /** T134.2: the corner mark (a white-label store's logo; null: plain). */ mark?: string | null }) {
  const { t } = useLang();
  const { asset } = useSiteEnv();
  const kind = kindOf(product);
  const [pair, setPair] = useState<{ id: string; expiresAt: number } | null>(null);
  const [qr, setQr] = useState('');
  const [failed, setFailed] = useState(false);
  const [received, setReceived] = useState<Received[]>([]);
  const [shown, setShown] = useState<number | null>(null);
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
        const png = await markedQrPng(`${location.origin}/capture/${p.id}`, 480, mark, { dark: '#0A2237', light: '#ffffff' });
        if (live) { setPair(p); setQr(png); }
      } catch { if (live) setFailed(true); }
    })();
    return () => { live = false; };
  }, [kind, product.demo, product.sku, round, mark]);

  // the phone's photos, as the shopper sends them — the pairing keeps listening after the first (T139); a new code
  // when it expires
  useEffect(() => {
    if (!pair) return;
    let done = false, pending = false, seq = 0;
    const timer = setInterval(async () => {
      if (done || pending) return;
      pending = true;
      try {
        if (Date.now() > pair.expiresAt) { clearInterval(timer); setRound((n) => n + 1); return; }
        const next = await nextPhoto(pair.id);
        if (next === 'expired') { clearInterval(timer); setRound((n) => n + 1); return; }
        if (!next) return;
        const pose = poseFromHeader(next.pose);
        const src = URL.createObjectURL(next.blob);
        const img = new Image();
        img.onload = () => {
          if (done) return;
          const id = Date.now() * 100 + (seq++ % 100);
          setReceived((list) => [...list, { id, src, width: img.naturalWidth, height: img.naturalHeight, pose }].slice(-MAX_RECEIVED));
          setShown(id);
        };
        img.src = src;
      } catch { /* try again on the next tick */ } finally { pending = false; }
    }, 2500);
    return () => { done = true; clearInterval(timer); };
  }, [pair]);
  // leaving ends the pairing (anything not yet received goes with it)
  useEffect(() => () => { if (pair) void fetch(`/api/pair/${pair.id}`, { method: 'DELETE', keepalive: true }); }, [pair]);

  const name = t(product.name.ar, product.name.en);
  const current = received.find((r) => r.id === shown) ?? received.at(-1);
  if (current) {
    const box = 560, f = Math.min(box / current.width, box / current.height);
    const w = current.width * f, h = current.height * f;
    const p = current.pose;
    const pw = p ? p.width * current.width * f : 0;
    return (
      <div className="pq">
        <div className="pq-photo" style={{ width: w, height: h }}>
          <img src={current.src} alt={t('صورتك من جوالك', 'Your photo from your phone')} />
          {p && (
            <div className="pq-placed" style={{ filter: cssShadow(SHADOW[kind] ?? 'watch', pw) }}>
              <img src={worn} alt={name} data-pose={`${Math.round(p.x * w)},${Math.round(p.y * h)},${Math.round(pw)},${Math.round(p.angle)}`}
                style={{ left: p.x * w - pw / 2, top: p.y * h - (pw * aspect) / 2, width: pw, height: pw * aspect, transform: `rotate(${p.angle}deg)` }} />
            </div>
          )}
        </div>
        {received.length > 1 && (
          <div className="my-photos" role="group" aria-label={t('صورك', 'Your photos')}>
            {received.map((r, n) => (
              <span key={r.id} className={'my-photo' + (r.id === current.id ? ' selected' : '')}>
                <button type="button" onClick={() => setShown(r.id)} aria-pressed={r.id === current.id} aria-label={t(`الصورة ${n + 1}`, `Photo ${n + 1}`)}><img src={r.src} alt="" /></button>
              </span>
            ))}
          </div>
        )}
        {/* T139: the same pairing takes more — the phone sends another, it appears here */}
        <p className="pq-hint"><Smartphone size={15} aria-hidden /> {t('أرسل صورًا أخرى من جوالك وستظهر هنا.', 'Send more photos from your phone — they appear here.')}</p>
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
