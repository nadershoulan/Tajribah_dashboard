'use client';

import { Plus } from 'lucide-react';
import { useLang, pick } from '@/lib/i18n';
import { SiteLink } from '@/lib/site-env';
import { INDUSTRIES, INDUSTRY_ORDER, industry, type Industry } from '@/content/industries';
import { Forward, Shell } from '@/components/site/chrome';
import { Checks, CtaBand, PageHero, SectionHead, Tag } from '@/components/site/ui';
import NotFound from '@/components/pages/NotFound';

/** M6 — one page per kind of store, from `content/industries.ts`. */

export function IndustriesIndex() {
  const { lang, t } = useLang();
  const p = (b: { ar: string; en: string }) => pick(b, lang);
  return (
    <Shell current="/industries">
      <PageHero eyebrow={t('الحلول', 'Solutions')} title={t('حسب ما تبيعه', 'By what you sell')}
        lead={t('ما يعمل اليوم لكل فئة، وما لم يُبنَ بعد — مكتوبًا بوضوح.', 'What works today for each category, and what is not built yet — written plainly.')} />
      <section className="sec">
        <div className="wrap grid-4">
          {INDUSTRY_ORDER.map((slug) => {
            const it = INDUSTRIES[slug];
            const now = it.modes.filter((m) => m.status === 'now').length;
            return (
              <SiteLink key={slug} href={`/industries/${slug}`} className="feature layer link-card">
                <h3>{p(it.nav)}</h3>
                <p>{p(it.question)}</p>
                <p className="fine">{t(`${now} من طرق التجربة متاحة اليوم`, `${now} way${now === 1 ? '' : 's'} to try available today`)}</p>
                <span className="link-more">{t('اعرف المزيد', 'Read more')}<Forward size={16} /></span>
              </SiteLink>
            );
          })}
        </div>
      </section>
      <CtaBand />
    </Shell>
  );
}

function IndustryDetail({ page }: { page: Industry }) {
  const { lang, t } = useLang();
  const p = (b: { ar: string; en: string }) => pick(b, lang);
  const others = INDUSTRY_ORDER.filter((s) => s !== page.slug).map((s) => INDUSTRIES[s]);
  return (
    <Shell current="/industries">
      <PageHero eyebrow={p(page.nav)} title={p(page.hero.title)} lead={p(page.hero.lead)}>
        <div className="hero-actions">
          <SiteLink href="/demo" className="btn btn-primary">{t('جرّب العرض التجريبي', 'Try the live demo')}<Forward /></SiteLink>
          <SiteLink href="/contact" className="btn btn-ghost">{t('احجز عرضًا لمتجرك', 'Book a store demo')}</SiteLink>
        </div>
      </PageHero>

      <section className="sec">
        <div className="wrap narrow">
          <SectionHead eyebrow={t('السؤال', 'The question')} title={p(page.question)} />
          <div className="prose">{page.problem.map((b) => <p key={b.en}>{p(b)}</p>)}</div>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap">
          <SectionHead eyebrow={t('طرق التجربة', 'Ways to try')} title={t('ما يعمل اليوم، وما لم يُبنَ بعد', 'What works today, and what is not built yet')} />
          <div className="grid-2">
            {page.modes.map((m) => {
              const body = (
                <>
                  <h3>{p(m.label)} {m.status === 'now' ? <Tag kind="live">{t('متاح اليوم', 'Available today')}</Tag> : <Tag kind="soon">{t('لم يُبنَ بعد', 'Not built yet')}</Tag>}</h3>
                  <p>{p(m.note)}</p>
                  {m.feature && <span className="link-more">{t('كيف تعمل', 'How it works')}<Forward size={16} /></span>}
                </>
              );
              return m.feature
                ? <SiteLink key={m.label.en} href={`/features/${m.feature}`} className="feature layer link-card">{body}</SiteLink>
                : <article key={m.label.en} className="feature layer">{body}</article>;
            })}
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap split">
          <div>
            <SectionHead eyebrow={t('للتاجر', 'For merchants')} title={t('ما تقيسه لكل منتج', 'What you measure for each product')} />
            <Checks items={page.measure.map(p)} />
          </div>
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

      <section className="sec sec-tint">
        <div className="wrap">
          <SectionHead eyebrow={t('فئات أخرى', 'Other categories')} title={t('لمتاجر أخرى', 'For other stores')} />
          <div className="grid-3">
            {others.map((o) => (
              <SiteLink key={o.slug} href={`/industries/${o.slug}`} className="feature layer link-card">
                <h3>{p(o.nav)}</h3><p>{p(o.question)}</p>
                <span className="link-more">{t('اعرف المزيد', 'Read more')}<Forward size={16} /></span>
              </SiteLink>
            ))}
          </div>
        </div>
      </section>

      <CtaBand />
    </Shell>
  );
}

export function IndustryPageBySlug({ slug }: { slug: string }) {
  const page = industry(slug);
  return page ? <IndustryDetail page={page} /> : <NotFound />;
}
