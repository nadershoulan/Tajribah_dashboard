import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import { BLOG_POSTS, blogPost } from '@/content/blog';
import { BlogPostPage } from '@/components/pages/Resources';
import { COMPANY } from '@/lib/site';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug;
  const post = blogPost(slug);
  return pageMeta(`/blog/${slug}`, { title: post?.title.ar ?? 'المدونة', description: post?.excerpt.ar });
}

export default async function Page({ params }: Props) {
  const { slug } = await params;
  const post = blogPost(slug);
  // M12 — the article, for search engines, in Arabic (the site's default language).
  const article = post && {
    '@context': 'https://schema.org', '@type': 'BlogPosting', headline: post.title.ar, description: post.excerpt.ar,
    datePublished: post.date, inLanguage: 'ar', url: `${COMPANY.siteUrl}/blog/${post.slug}`,
    author: { '@type': 'Organization', name: 'Tajribah' }, publisher: { '@type': 'Organization', name: COMPANY.legalName.en },
  };
  return (
    <>
      {article && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(article) }} />}
      <BlogPostPage slug={slug} />
    </>
  );
}
