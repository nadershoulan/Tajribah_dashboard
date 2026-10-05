'use client';

import { Plus } from 'lucide-react';
import { useLang } from '@site/lib/i18n';
import { pick } from '@site/lib/lang';
import { SiteLink } from '@site/lib/site-env';
import { COMPANY } from '@site/lib/site';
import { PLATFORM_PAGES, TRADEMARK_NOTE, type PlatformPage } from '@site/content/platforms';
import { Forward, Shell } from '@site/components/site/chrome';
import { Checks, CtaBand, PageHero, SectionHead } from '@site/components/site/ui';

/** M4 — one landing page per store platform, from `content/platforms.ts`. */
function PlatformLanding({ page }: { page: PlatformPage }) {
  const { t, lang } = useLang();
  const p = (b: { ar: string; en: string }) => pick(b, lang);
  return (
    <Shell current="/integrations">
      <PageHero eyebrow={t(`لمتاجر ${page.name.ar}`, `For ${page.name.en} stores`)} title={p(page.hero.title)} lead={p(page.hero.lead)}>
        <div className="hero-actions">
          <SiteLink href={`${COMPANY.appUrl}/register`} className="btn btn-primary">{t('ابدأ من رابط منتجاتك', 'Start from your product feed')}<Forward /></SiteLink>
          <SiteLink href="/demo" className="btn btn-ghost">{t('جرّب العرض التجريبي', 'Try the live demo')}</SiteLink>
        </div>
      </PageHero>

      <section className="sec">
        <div className="wrap">
          <SectionHead eyebrow={t('التركيب', 'Setup')} title={t(`من متجرك على ${page.name.ar} إلى أول تجربة`, `From your ${page.name.en} store to the first try-on`)} />
          <ol className="steps">
            {page.steps.map((s, i) => (
              <li key={s.title.en}><span className="step-n">{i + 1}</span><div><h3>{p(s.title)}</h3><p>{p(s.body)}</p></div></li>
            ))}
          </ol>
          <p className="fine">{t(`الربط المباشر بـ${page.name.ar} عبر تطبيق في ${p(page.appStore)} يأتي في الإصدار الثاني.`,
            `Linking directly with ${page.name.en}, through an app in ${p(page.appStore)}, comes in version 2.`)}</p>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap split">
          <div>
            <SectionHead eyebrow={t('ما نقرؤه', 'What we read')} title={t(`كتالوجك في ${page.name.ar} يبقى مصدر الحقيقة`, `Your ${page.name.en} catalogue stays the source of truth`)} />
            <Checks items={page.syncs.map(p)} />
          </div>
          <div className="stack-cards">
            {page.fit.map((f) => (
              <article key={f.title.en} className="panel-card"><h3>{p(f.title)}</h3><p>{p(f.body)}</p></article>
            ))}
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap narrow">
          <SectionHead eyebrow={t('أسئلة', 'Questions')} title={t(`أسئلة تجّار ${page.name.ar}`, `Questions from ${page.name.en} merchants`)} />
          <div className="faq">
            {page.faq.map((it) => (
              <details key={it.q.en} className="qa">
                <summary><span>{p(it.q)}</span><Plus size={18} aria-hidden /></summary>
                <p>{p(it.a)}</p>
              </details>
            ))}
          </div>
          <p className="fine">{p(TRADEMARK_NOTE)}</p>
        </div>
      </section>

      <CtaBand />
    </Shell>
  );
}

export function SallaPage() { return <PlatformLanding page={PLATFORM_PAGES.salla} />; }
export function ZidPage() { return <PlatformLanding page={PLATFORM_PAGES.zid} />; }
