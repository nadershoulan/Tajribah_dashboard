'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import { useLang } from '@site/lib/i18n';
import { SiteLink, useSiteEnv } from '@site/lib/site-env';
import { DEMO_WATCH, MODELS, STAGE } from '@site/lib/demo-product';
import { Forward } from './chrome';

/** The logo's scan brackets, used as a frame around anything being "looked at". */
export function Frame({ children, className = '' }: { children: ReactNode; className?: string }) {
  return (
    <div className={'frame ' + className}>
      <i aria-hidden /><i aria-hidden /><i aria-hidden /><i aria-hidden />
      {children}
    </div>
  );
}

export function SectionHead({ eyebrow, title, lead, center = false }: { eyebrow?: string; title: ReactNode; lead?: ReactNode; center?: boolean }) {
  return (
    <div className={'sec-head' + (center ? ' center' : '')}>
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h2>{title}</h2>
      {lead && <p className="lead">{lead}</p>}
    </div>
  );
}

export function PageHero({ eyebrow, title, lead, children }: { eyebrow: string; title: ReactNode; lead?: ReactNode; children?: ReactNode }) {
  return (
    <section className="page-hero">
      <div className="wrap">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        {lead && <p className="lead">{lead}</p>}
        {children}
      </div>
    </section>
  );
}

export function Tag({ kind, children }: { kind: 'live' | 'soon' | 'neutral'; children: ReactNode }) {
  return <span className={'tag tag-' + kind}>{children}</span>;
}

export function Checks({ items }: { items: string[] }) {
  return <ul className="checks">{items.map((i) => <li key={i}><Check size={16} aria-hidden />{i}</li>)}</ul>;
}

export function CtaBand() {
  const { t } = useLang();
  return (
    <section className="cta-band">
      <div className="wrap cta-inner">
        <div>
          <h2>{t('شاهدها على منتجاتك أنت', 'See it on your own products')}</h2>
          <p>{t('نجهّز لك عرضًا على منتج من متجرك، ونريك كيف سيظهر في صفحة المنتج قبل أن تلتزم بأي باقة.',
            'We set up a demo on one of your products and show you how it will look on the product page before you commit to a plan.')}</p>
        </div>
        <div className="cta-actions">
          <SiteLink href="/contact" className="btn btn-light">{t('احجز عرضًا لمتجرك', 'Book a store demo')}<Forward /></SiteLink>
          <SiteLink href="/demo" className="btn btn-outline-light">{t('جرّب العرض التجريبي', 'Try the live demo')}</SiteLink>
        </div>
      </div>
    </section>
  );
}

/**
 * The landing-page hero is the product itself: the demo watch composited onto
 * the model photo at the studio's own pose, so the first thing a visitor sees
 * is exactly what the studio shows.
 */
export function LiveScene() {
  const { t } = useLang();
  const { asset } = useSiteEnv();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    let live = true;
    const load = (src: string) =>
      new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = asset(src);
      });
    Promise.all([load(MODELS[0].src), load(DEMO_WATCH.worn)])
      .then(([bg, watch]) => {
        const ctx = ref.current?.getContext('2d');
        if (!live || !ctx) return;
        ctx.direction = 'ltr';
        ctx.drawImage(bg, 0, 0, STAGE.W, STAGE.H);
        const p = MODELS[0].pose;
        const w = p.width, h = (w * watch.height) / watch.width;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.angle * Math.PI) / 180);
        ctx.shadowColor = 'rgba(10,34,55,.2)'; ctx.shadowBlur = 6; ctx.shadowOffsetY = 3;
        ctx.drawImage(watch, -w / 2, -h / 2, w, h);
        ctx.shadowColor = 'transparent';
        // the case width, measured the way the studio measures it
        const y = h / 2 + 26;
        ctx.strokeStyle = '#00A7BC'; ctx.lineWidth = 2; ctx.beginPath();
        ctx.moveTo(-w / 2, y); ctx.lineTo(w / 2, y);
        ctx.moveTo(-w / 2, y - 7); ctx.lineTo(-w / 2, y + 7);
        ctx.moveTo(w / 2, y - 7); ctx.lineTo(w / 2, y + 7);
        ctx.stroke();
        ctx.fillStyle = '#0A2237'; ctx.font = '600 19px "IBM Plex Mono", monospace'; ctx.textAlign = 'center';
        ctx.fillText(`${DEMO_WATCH.caseMm} mm`, 0, y + 31);
        ctx.restore();
      })
      .catch(() => {});
    return () => { live = false; };
  }, [asset]);

  return (
    <div className="live-scene">
      <Frame className="live-frame">
        <canvas ref={ref} width={STAGE.W} height={STAGE.H} role="img"
          aria-label={t('الساعة على معصم عارضة بالمقاس الحقيقي', 'The watch on a model wrist at true scale')} />
        <span className="live-chip"><span className="pulse" />{t('مقاس حقيقي', 'True scale')}</span>
      </Frame>
    </div>
  );
}
