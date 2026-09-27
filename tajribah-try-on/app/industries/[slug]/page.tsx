import type { Metadata } from 'next';
import { INDUSTRY_ORDER, industry } from '@/content/industries';
import { IndustryPageBySlug } from '@/components/pages/Industries';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return INDUSTRY_ORDER.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const page = industry((await params).slug);
  return { title: page?.hero.title.ar ?? 'الحلول', description: page?.hero.lead.ar };
}

export default async function Page({ params }: Props) {
  return <IndustryPageBySlug slug={(await params).slug} />;
}
