'use client';

import { Plus } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { pick } from '@/lib/lang';
import { SiteLink } from '@/lib/site-env';
import { PLATFORM_PAGES, TRADEMARK_NOTE, type PlatformPage } from '@/content/platforms';
import { Forward, Shell } from '@/components/site/chrome';
import { Checks, CtaBand, PageHero, SectionHead } from '@/components/site/ui';

/** M4 — one landing page per store platform, from `content/platforms.ts`. */
function PlatformLanding({ page }: { page: PlatformPage }) {
  const { t, lang } = useLang();
  const p = (b: { ar: string; en: string }) => pick(b, lang);
  return (
    <Shell current="/integrations">
      <PageHero eyebrow={t(`لمتاجر ${page.name.ar}`, `For ${page.name.en} stores`)} title={p(page.hero.title)} lead={p(page.hero.lead)}>
        <div className="hero-actions">
          <SiteLink href="/contact" className="btn btn-primary">{t('أضف متجري إلى الدفعة القادمة', 'Add my store to the next group')}<Forward /></SiteLink>
          <SiteLink href="/demo" className="btn btn-ghost">{t('جرّب العرض التجريبي', 'Try the live demo')}</SiteLink>
        </div>
      </PageHero>

      <section className="sec">
        <div className="wrap">
          <SectionHead eyebrow={t('التركيب', 'Setup')} title={t(`من ${p(page.appStore)} إلى أول تجربة`, `From ${p(page.appStore)} to the first try-on`)} />
          <ol className="steps">
            {page.steps.map((s, i) => (
              <li key={s.title.en}><span className="step-n">{i + 1}</span><div><h3>{p(s.title)}</h3><p>{p(s.body)}</p></div></li>
            ))}
          </ol>
          <p className="fine">{t('نعمل حاليًا مع المتاجر الأولى بالتنسيق المباشر قبل فتح الإدراج العام في متجر التطبيقات.',
            'We are onboarding our first stores directly before the public app-store listing opens.')}</p>
        </div>
      </section>

      <section className="sec sec-tint">
        <div className="wrap split">
          <div>
            <SectionHead eyebrow={t('ما يُزامَن', 'What syncs')} title={t(`كتالوجك في ${page.name.ar} يبقى مصدر الحقيقة`, `Your ${page.name.en} catalogue stays the source of truth`)} />
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
