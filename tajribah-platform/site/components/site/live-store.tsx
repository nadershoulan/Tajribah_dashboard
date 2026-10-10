'use client';

/**
 * T127 — "try it on a live store": a real product page on a real Salla store (Failet) where the try-on button is
 * live, installed through Google Tag Manager as any Salla store would. Shown on the customers and partners pages
 * (Nader, 2026-10-10). Some ad blockers block Tag Manager, which loads the button — so the visitor is told what to
 * do if it does not appear.
 */
import { ExternalLink, ShieldOff } from 'lucide-react';
import { useLang } from '@site/lib/i18n';

/** The first product published live (2026-10-10): a Sans Lauris women's watch on failet.sa. */
export const LIVE_STORE_PRODUCT = 'https://failet.sa/ar/%D8%B3%D8%A7%D8%B9%D8%A7%D8%AA%20%D9%86%D8%B3%D8%A7%D8%A6%D9%8A%D8%A9/p1617831548';

export function LiveStoreCard() {
  const { t } = useLang();
  return (
    <section className="sec sec-tint" aria-labelledby="live-store-h">
      <div className="wrap narrow">
        <article className="panel-card">
          <p className="eyebrow">{t('على متجر حقيقي', 'On a real store')}</p>
          <h2 className="h2" id="live-store-h">{t('جرّبها بنفسك على متجر يعمل الآن', 'Try it yourself on a store that is live now')}</h2>
          <p>{t(
            'متجر فايلت على سلة يعرض زر «جرّبها على معصمك» في صفحة هذه الساعة. افتحه من جوالك أو حاسوبك، واضغط الزر: جرّب الساعة على النموذج، أو قارن مقاسها الحقيقي، أو جرّبها على صورتك أنت — بمسح رمز QR بجوالك.',
            'Failet, a store on Salla, shows a “Try it on your wrist” button on this watch’s page. Open it on your phone or computer and press the button: try the watch on the model, compare its true size, or try it on your own photo — by scanning a QR code with your phone.',
          )}</p>
          <p style={{ marginTop: 16 }}>
            <a className="btn btn-primary" href={LIVE_STORE_PRODUCT} target="_blank" rel="noopener noreferrer">
              {t('افتح المنتج في متجر فايلت', 'Open the product on Failet')} <ExternalLink size={16} aria-hidden />
            </a>
          </p>
          <p className="fine" role="note" style={{ marginTop: 16 }}>
            <ShieldOff size={16} aria-hidden style={{ verticalAlign: '-3px' }} />{' '}
            {t(
              'لا يظهر الزر؟ أوقف مانع الإعلانات (Ad blocker) لموقع failet.sa ثم حدّث الصفحة — بعض موانع الإعلانات تمنع Google Tag Manager الذي يحمّل الزر.',
              'No button? Turn off your ad blocker for failet.sa and reload — some ad blockers block Google Tag Manager, which loads the button.',
            )}
          </p>
        </article>
      </div>
    </section>
  );
}
