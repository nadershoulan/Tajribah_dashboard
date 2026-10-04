import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import { HELP_ARTICLES, helpArticle } from '@site/content/help';
import { HelpArticlePage } from '@site/components/pages/Resources';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return HELP_ARTICLES.map((a) => ({ slug: a.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug;
  const article = helpArticle(slug);
  return pageMeta(`/help/${slug}`, { title: article?.title.ar ?? 'مركز المساعدة', description: article?.summary.ar });
}

export default async function Page({ params }: Props) {
  return <HelpArticlePage slug={(await params).slug} />;
}
