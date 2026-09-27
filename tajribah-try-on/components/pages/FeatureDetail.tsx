'use client';

import { Camera, Hand, Minus, Plus, QrCode, Ruler } from 'lucide-react';
import { useLang, pick } from '@/lib/i18n';
import { SiteLink } from '@/lib/site-env';
import { FEATURE_ORDER, FEATURE_PAGES, featurePage, type FeaturePage } from '@/content/features';
import { Forward, Shell } from '@/components/site/chrome';
import { Checks, CtaBand, PageHero, SectionHead } from '@/components/site/ui';
import NotFound from '@/components/pages/NotFound';

/** M5 — one page per way to try, from `content/features.ts`. */

const ICONS = { hand: Hand, camera: Camera, ruler: Ruler, qr: QrCode };

function FeatureDetail({ page }: { page: FeaturePage }) {
  const { lang, t } = useLang();
  const p = (b: { ar: string; en: string }) => pick(b, lang);
  const others = FEATURE_ORDER.filter((s) => s !== page.slug).map((s) => FEATURE_PAGES[s]);

  return (
    <Shell current="/features">
      <PageHero eyebrow={t('المزايا', 'Features')} title={p(page.hero.title)} lead={p(page.hero.lead)}>
        <div className="hero-actions">
          <SiteLink href="/demo" className="btn btn-primary">{t('جرّبها الآن', 'Try it now')}<Forward /></SiteLink>
          <SiteLink href="/features" className="btn btn-ghost">{t('كل المزايا', 'All features')}</SiteLink>
        </div>
      </PageHero>

      <section className="sec">
        <div className="wrap">
          <SectionHead eyebrow={t('للمتسوّق', 'For shoppers')} title={t('ما يفعله عميلك', 'What your shopper does')} />
          <ol className="steps">
            {page.steps.map((s, i) => (
              <li key={s.title.en}><span className="step-n">{i + 1}</span><div><h3>{p(s.title)}</h3><p>{p(s.body)}</p></div></li>
            ))}
          </ol>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap">
          <SectionHead eyebrow={t('تحت السطح', 'Underneath')} title={t('كيف تعمل', 'How it works')} />
          <div className="grid-3">
            {page.how.map((h) => (
              <article key={h.title.en} className="feature layer"><h3>{p(h.title)}</h3><p>{p(h.body)}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap split">
          <div>
            <SectionHead eyebrow={t('للتاجر', 'For merchants')} title={t('ما تحتاج إعداده', 'What you set up')} />
            <Checks items={page.setup.map(p)} />
          </div>
          <div className="panel-card">
            <h3>{t('وما لا تفعله', 'And what it does not do')}</h3>
            <ul className="limits">
              {page.limits.map((l) => <li key={l.en}><Minus size={16} aria-hidden />{p(l)}</li>)}
            </ul>
          </div>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap narrow">
          <SectionHead eyebrow={t('أسئلة', 'Questions')} title={t('أسئلة متكرّرة', 'Questions we are asked')} />
          <div className="faq">
            {page.faq.map((it) => (
              <details key={it.q.en} className="qa">
                <summary><span>{p(it.q)}</span><Plus size={18} aria-hidden /></summary>
                <p>{p(it.a)}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <SectionHead eyebrow={t('الطرق الأخرى', 'The other ways')} title={t('ثلاث طرق أخرى للتجربة', 'Three more ways to try')} />
          <div className="grid-3">
            {others.map((o) => {
              const Icon = ICONS[o.icon];
              return (
                <SiteLink key={o.slug} href={`/features/${o.slug}`} className="feature layer link-card">
                  <span className="f-icon"><Icon size={20} aria-hidden /></span>
                  <h3>{p(o.nav)}</h3>
                  <p>{p(o.hero.title)}</p>
                  <span className="link-more">{t('اعرف المزيد', 'Read more')}<Forward size={16} /></span>
                </SiteLink>
              );
            })}
          </div>
        </div>
      </section>

      <CtaBand />
    </Shell>
  );
}

export function FeaturePageBySlug({ slug }: { slug: string }) {
  const page = featurePage(slug);
  return page ? <FeatureDetail page={page} /> : <NotFound />;
}
