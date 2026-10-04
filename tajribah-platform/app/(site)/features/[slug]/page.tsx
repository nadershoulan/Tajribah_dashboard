import type { Metadata } from 'next';
import { pageMeta } from '@site/lib/seo';
import { FEATURE_ORDER, featurePage } from '@site/content/features';
import { FeaturePageBySlug } from '@site/components/pages/FeatureDetail';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return FEATURE_ORDER.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug;
  const page = featurePage(slug);
  return pageMeta(`/features/${slug}`, { title: page?.hero.title.ar ?? 'المزايا', description: page?.hero.lead.ar });
}

export default async function Page({ params }: Props) {
  return <FeaturePageBySlug slug={(await params).slug} />;
}
