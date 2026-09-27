import type { Metadata } from 'next';
import { FEATURE_ORDER, featurePage } from '@/content/features';
import { FeaturePageBySlug } from '@/components/pages/FeatureDetail';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return FEATURE_ORDER.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = featurePage((await params).slug);
  return { title: page?.hero.title.ar ?? 'المزايا', description: page?.hero.lead.ar };
}

export default async function Page({ params }: Props) {
  return <FeaturePageBySlug slug={(await params).slug} />;
}
