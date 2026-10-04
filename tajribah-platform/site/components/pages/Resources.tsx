'use client';

import { BookOpen, Briefcase, CircleHelp, Info, MapPin, Store } from 'lucide-react';
import { useLang } from '@site/lib/i18n';
import { pick, type Bi, type Lang } from '@site/lib/lang';
import { SiteLink } from '@site/lib/site-env';
import { COMPANY } from '@site/lib/site';
import { HELP_ARTICLES, HELP_CATEGORIES, helpArticle } from '@site/content/help';
import { BLOG_AUTHOR, BLOG_POSTS, blogPost } from '@site/content/blog';
import { ILLUSTRATIVE, STORIES } from '@site/content/stories';
import { EXPECTED_ROLES, HOW_WE_WORK } from '@site/content/careers';
import { Forward, Shell } from '@site/components/site/chrome';
import { Checks, CtaBand, PageHero, SectionHead, Tag } from '@site/components/site/ui';
import NotFound from './NotFound';

/** Gregorian dates with ASCII digits in both languages, as the rest of the site writes them. */
const dateOf = (iso: string, lang: Lang) =>
  new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Riyadh' })
    .format(new Date(`${iso}T12:00:00+03:00`));

// ------------------------------------------------------------------ help centre (M8)

export function HelpIndex() {
  const { t, lang } = useLang();
  return (
    <Shell current="/help">
      <PageHero eyebrow={t('مركز المساعدة', 'Help centre')} title={t('كيف نساعدك؟', 'How can we help?')}
        lead={t('إجابات قصيرة لأسئلة الإعداد والاستخدام، مكتوبة على لوحة التحكم كما هي.', 'Short answers for setting up and using Tajribah, written against the dashboard as it is.')} />
      <section className="sec">
        <div className="wrap grid-3">
          {HELP_CATEGORIES.map((c) => (
            <article key={c.key} className="q-card">
              <h3><CircleHelp size={18} aria-hidden /> {pick(c.title, lang)}</h3>
              <p>{pick(c.blurb, lang)}</p>
              <ul className="plain">
                {HELP_ARTICLES.filter((a) => a.category === c.key).map((a) => (
                  <li key={a.slug}><SiteLink href={`/help/${a.slug}`}>{pick(a.title, lang)}</SiteLink></li>
                ))}
              </ul>
            </article>
          ))}
        </div>
      </section>
      <section className="sec sec-tint">
        <div className="wrap narrow center-text">
          <h2 className="h2">{t('لم تجد ما تبحث عنه؟', 'Didn’t find it?')}</h2>
          <p className="lead">{t('راسلنا وسيرد عليك شخص من الفريق.', 'Write to us and someone from the team will reply.')}</p>
          <SiteLink href="/contact" className="btn btn-primary">{t('تواصل معنا', 'Contact us')}<Forward /></SiteLink>
        </div>
      </section>
    </Shell>
  );
}

export function HelpArticlePage({ slug }: { slug: string }) {
  const { t, lang } = useLang();
  const article = helpArticle(slug);
  if (!article) return <NotFound />;
  const category = HELP_CATEGORIES.find((c) => c.key === article.category)!;
  const related = HELP_ARTICLES.filter((a) => a.category === article.category && a.slug !== slug);
  return (
    <Shell current="/help">
      <section className="page-hero legal-hero">
        <div className="wrap">
          <nav className="crumbs" aria-label={t('مسار التنقل', 'Breadcrumb')}>
            <SiteLink href="/help">{t('مركز المساعدة', 'Help centre')}</SiteLink><span aria-hidden>/</span><span>{pick(category.title, lang)}</span>
          </nav>
          <h1>{pick(article.title, lang)}</h1>
          <p className="lead">{pick(article.summary, lang)}</p>
          <p className="legal-meta">{t('آخر تحديث:', 'Last updated:')} {dateOf(article.updated, lang)}</p>
        </div>
      </section>
      <section className="sec legal-sec">
        <div className="wrap legal-grid">
          <aside className="legal-aside">
            <nav aria-label={t('مقالات ذات صلة', 'Related articles')}>
              <p className="aside-h">{pick(category.title, lang)}</p>
              <ul>{related.map((a) => <li key={a.slug}><SiteLink href={`/help/${a.slug}`}>{pick(a.title, lang)}</SiteLink></li>)}</ul>
            </nav>
          </aside>
          <article className="legal-body">
            {article.steps && (
              <section>
                <h2>{t('الخطوات', 'Steps')}</h2>
                <ol className="steps">
                  {article.steps.map((s, i) => <li key={s.en}><span className="step-n">{i + 1}</span><div><p>{pick(s, lang)}</p></div></li>)}
                </ol>
              </section>
            )}
            <section>
              {article.steps && <h2>{t('تفاصيل', 'Details')}</h2>}
              {article.body.map((p) => <p key={p.en}>{pick(p, lang)}</p>)}
            </section>
          </article>
        </div>
      </section>
    </Shell>
  );
}

// ------------------------------------------------------------------ blog (M7)

export function BlogIndex() {
  const { t, lang } = useLang();
  const posts = [...BLOG_POSTS].sort((a, b) => b.date.localeCompare(a.date));
  return (
    <Shell current="/blog">
      <PageHero eyebrow={t('المدونة', 'Blog')} title={t('عن البيع أونلاين حين يكون الحجم هو السؤال', 'On selling online when size is the question')}
        lead={t('ملاحظات من فريق تجربة لتجّار الساعات والمجوهرات والإكسسوارات.', 'Notes from the Tajribah team for watch, jewellery and accessory merchants.')} />
      <section className="sec">
        <div className="wrap grid-3">
          {posts.map((p) => (
            <article key={p.slug} className="q-card">
              <p className="eyebrow">{pick(p.tag, lang)} · {dateOf(p.date, lang)}</p>
              <h3><SiteLink href={`/blog/${p.slug}`}>{pick(p.title, lang)}</SiteLink></h3>
              <p>{pick(p.excerpt, lang)}</p>
              <SiteLink href={`/blog/${p.slug}`} className="link-more">{t('اقرأ المقال', 'Read the article')}<Forward size={16} /></SiteLink>
            </article>
          ))}
        </div>
      </section>
    </Shell>
  );
}

export function BlogPostPage({ slug }: { slug: string }) {
  const { t, lang } = useLang();
  const post = blogPost(slug);
  if (!post) return <NotFound />;
  const more = BLOG_POSTS.filter((p) => p.slug !== slug).slice(0, 4);
  return (
    <Shell current="/blog">
      <section className="page-hero legal-hero">
        <div className="wrap">
          <nav className="crumbs" aria-label={t('مسار التنقل', 'Breadcrumb')}>
            <SiteLink href="/blog">{t('المدونة', 'Blog')}</SiteLink><span aria-hidden>/</span><span>{pick(post.tag, lang)}</span>
          </nav>
          <h1>{pick(post.title, lang)}</h1>
          <p className="lead">{pick(post.excerpt, lang)}</p>
          <p className="legal-meta">{pick(BLOG_AUTHOR, lang)} · {dateOf(post.date, lang)} · {t(`قراءة ${post.minutes} دقائق`, `${post.minutes} min read`)}</p>
        </div>
      </section>
      <section className="sec legal-sec">
        <div className="wrap legal-grid">
          <aside className="legal-aside">
            <nav aria-label={t('مقالات أخرى', 'More articles')}>
              <p className="aside-h">{t('مقالات أخرى', 'More articles')}</p>
              <ul>{more.map((p) => <li key={p.slug}><SiteLink href={`/blog/${p.slug}`}>{pick(p.title, lang)}</SiteLink></li>)}</ul>
            </nav>
          </aside>
          <article className="legal-body">
            {post.sections.map((s, i) => (
              <section key={i}>
                {s.heading && <h2>{pick(s.heading, lang)}</h2>}
                {s.paragraphs.map((p) => <p key={p.en}>{pick(p, lang)}</p>)}
              </section>
            ))}
          </article>
        </div>
      </section>
      <CtaBand />
    </Shell>
  );
}

// ------------------------------------------------------------------ customer stories (M9)

export function StoriesPage() {
  const { t, lang } = useLang();
  const p = (b: Bi) => pick(b, lang);
  return (
    <Shell current="/customers">
      <PageHero eyebrow={t('قصص الاستخدام', 'Customer stories')} title={t('كيف تستخدم المتاجر تجربة', 'How stores use Tajribah')}
        lead={t('ثلاثة أمثلة لطرق تفعيل التجربة حسب نوع المتجر ومنصته، وما يستحق القياس بعدها.', 'Three examples of how to set up try-on by store type and platform, and what is worth measuring afterwards.')} />
      <section className="sec">
        <div className="wrap">
          <div className="panel-card" role="note"><p><Info size={18} aria-hidden style={{ verticalAlign: '-3px' }} /> <strong>{p(ILLUSTRATIVE)}</strong></p></div>
          <div className="stack-cards" style={{ marginTop: 24 }}>
            {STORIES.map((s) => (
              <article key={s.slug} className="panel-card">
                <p className="eyebrow"><Tag kind="neutral">{t('مثال توضيحي', 'Illustrative')}</Tag> <Store size={14} aria-hidden /> {s.platform === 'Custom' ? t('منصة مخصصة', 'Custom platform') : s.platform} · <MapPin size={14} aria-hidden /> {p(s.city)}</p>
                <h3>{p(s.store)} — {p(s.kind)}</h3>
                <p><strong>{t('التحدي: ', 'The challenge: ')}</strong>{p(s.challenge)}</p>
                <Checks items={s.approach.map(p)} />
                <p><strong>{t('النتيجة في هذا المثال: ', 'The outcome in this example: ')}</strong>{p(s.outcome)}</p>
                <p className="fine">{t('ما يتابعه: ', 'What it tracks: ')}{s.tracked.map(p).join(lang === 'ar' ? '، ' : ', ')}</p>
              </article>
            ))}
          </div>
        </div>
      </section>
      <CtaBand />
    </Shell>
  );
}

// ------------------------------------------------------------------ careers (M10)

export function CareersPage() {
  const { t, lang } = useLang();
  const p = (b: Bi) => pick(b, lang);
  return (
    <Shell current="/careers">
      <PageHero eyebrow={t('الوظائف', 'Careers')} title={t('ابنِ معنا تجربة التسوّق العربية', 'Build Arabic-first shopping with us')}
        lead={t('فريق صغير في الرياض يبني التجربة الافتراضية لمتاجر السعودية.', 'A small team in Riyadh building virtual try-on for Saudi stores.')} />
      <section className="sec">
        <div className="wrap">
          <SectionHead eyebrow={t('طريقتنا', 'How we work')} title={t('ما نلتزم به', 'What we hold to')} />
          <div className="grid-4">
            {HOW_WE_WORK.map((w) => <article key={w.title.en} className="q-card"><h3>{p(w.title)}</h3><p>{p(w.body)}</p></article>)}
          </div>
        </div>
      </section>
      <section className="sec sec-tint">
        <div className="wrap">
          <SectionHead eyebrow={t('الأدوار', 'Roles')} title={t('أدوار نتوقع فتحها', 'Roles we expect to open')}
            lead={t('لا توجد وظائف معلنة الآن. إن رأيت نفسك في أحد هذه الأدوار، عرّفنا بنفسك ونتواصل معك حين يُفتح.', 'There are no advertised vacancies right now. If you see yourself in one of these roles, introduce yourself and we will be in touch when it opens.')} />
          <div className="grid-3">
            {EXPECTED_ROLES.map((r) => (
              <article key={r.title.en} className="q-card">
                <p className="eyebrow"><Briefcase size={14} aria-hidden /> {p(r.team)} · {p(r.place)}</p>
                <h3>{p(r.title)}</h3>
                <p>{p(r.about)}</p>
                <Checks items={r.you.map(p)} />
              </article>
            ))}
          </div>
          <p className="center-text" style={{ marginTop: 28 }}>
            <a className="btn btn-primary" href={`mailto:${COMPANY.email}?subject=${encodeURIComponent(t('اهتمام بالعمل في تجربة', 'Interest in working at Tajribah'))}`}>
              <BookOpen size={16} aria-hidden /> {t('عرّفنا بنفسك', 'Introduce yourself')}
            </a>
          </p>
        </div>
      </section>
    </Shell>
  );
}
