'use client';

import { useLang, pick } from '@/lib/i18n';
import { SiteLink } from '@/lib/site-env';
import { COMPANY, FOOTER } from '@/lib/site';
import { COOKIES, PRIVACY, REFUND, TERMS, TRYON, type Doc } from '@/content/legal';
import { Shell } from '@/components/site/chrome';

function LegalDoc({ doc, path }: { doc: Doc; path: string }) {
  const { lang, t } = useLang();
  const policies = FOOTER.find((c) => c.title.en === 'Policies')?.links ?? [];
  const legalName = pick(COMPANY.legalName, lang);

  return (
    <Shell current={path}>
      <section className="page-hero legal-hero">
        <div className="wrap">
          <p className="eyebrow">{t('السياسات', 'Policies')}</p>
          <h1>{pick(doc.title, lang)}</h1>
          <p className="lead">{pick(doc.summary, lang)}</p>
          <p className="legal-meta">{t('آخر تحديث:', 'Last updated:')} {pick(COMPANY.legalUpdated, lang)}</p>
        </div>
      </section>
      <section className="sec legal-sec">
        <div className="wrap legal-grid">
          <aside className="legal-aside">
            <nav aria-label={t('محتويات الصفحة', 'On this page')}>
              <p className="aside-h">{t('في هذه الصفحة', 'On this page')}</p>
              <ol>{doc.sections.map((s) => <li key={s.id}><a href={`#${s.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{pick(s.h, lang)}</a></li>)}</ol>
            </nav>
            <nav aria-label={t('سياسات أخرى', 'Other policies')}>
              <p className="aside-h">{t('سياسات أخرى', 'Other policies')}</p>
              <ul>{policies.filter((l) => l.href !== path).map((l) => <li key={l.href}><SiteLink href={l.href}>{pick(l.label, lang)}</SiteLink></li>)}</ul>
            </nav>
          </aside>
          <article className="legal-body">
            {doc.sections.map((s) => (
              <section key={s.id} id={s.id}>
                <h2>{pick(s.h, lang)}</h2>
                {s.body.map((b, i) => ('p' in b
                  ? <p key={i}>{pick(b.p, lang)}</p>
                  : <ul key={i}>{b.list.map((li) => <li key={li.en}>{pick(li, lang)}</li>)}</ul>))}
              </section>
            ))}
            <section id="contact">
              <h2>{t('التواصل', 'Contact')}</h2>
              <p>
                {legalName && <>{t('تُشغَّل تجربة من قبل', 'Tajribah is operated by')} {legalName}{COMPANY.crNumber && <> ({t('سجل تجاري', 'CR')} <bdi>{COMPANY.crNumber}</bdi>)</>}. </>}
                {t('لأي سؤال عن هذه السياسة أو لممارسة حقوقك، راسلنا على', 'For any question about this policy or to exercise your rights, email')}{' '}
                <a href={`mailto:${COMPANY.privacyEmail}`} dir="ltr">{COMPANY.privacyEmail}</a>.
              </p>
            </section>
          </article>
        </div>
      </section>
    </Shell>
  );
}

export const PrivacyPage = () => <LegalDoc doc={PRIVACY} path="/privacy" />;
export const TryOnPrivacyPage = () => <LegalDoc doc={TRYON} path="/try-on-privacy" />;
export const TermsPage = () => <LegalDoc doc={TERMS} path="/terms" />;
export const RefundPage = () => <LegalDoc doc={REFUND} path="/refund" />;
export const CookiesPage = () => <LegalDoc doc={COOKIES} path="/cookies" />;
