'use client';

/** T68 — partner and reseller terms (drafts awaiting counsel), and how to apply. */
import { Handshake } from 'lucide-react';
import { useLang } from '@/lib/i18n';
import { pick } from '@/lib/lang';
import { COMPANY } from '@/lib/site';
import { DRAFT_NOTE, PROGRAMS } from '@/content/partners';
import { Shell } from '@/components/site/chrome';
import { Checks, PageHero } from '@/components/site/ui';

export default function PartnersPage() {
  const { t, lang } = useLang();
  return (
    <Shell current="/partners">
      <PageHero eyebrow={t('الشركاء', 'Partners')} title={t('اكسب مع تجربة', 'Earn with Tajribah')}
        lead={t('عرّف المتاجر بالتجربة الافتراضية، أو أدر متاجر عملائك بسعر الوكالة.', 'Introduce stores to virtual try-on, or run your clients’ stores at agency prices.')} />
      <section className="sec">
        <div className="wrap">
          <div className="grid-2">
            {PROGRAMS.map((program) => (
              <article key={program.key} className="q-card">
                <p className="eyebrow"><Handshake size={14} aria-hidden /> {pick(program.title, lang)}</p>
                <p>{pick(program.who, lang)}</p>
                <Checks items={program.terms.map((term) => pick(term, lang))} />
              </article>
            ))}
          </div>
          <p className="legal-meta" style={{ marginTop: 20 }}>{pick(DRAFT_NOTE, lang)}</p>
          <p className="center-text" style={{ marginTop: 28 }}>
            <a className="btn btn-primary" href={`mailto:${COMPANY.email}?subject=${encodeURIComponent(t('طلب انضمام لبرنامج الشركاء', 'Partner programme application'))}`}>
              {t('قدّم طلبك بالبريد', 'Apply by email')}
            </a>
          </p>
        </div>
      </section>
    </Shell>
  );
}
