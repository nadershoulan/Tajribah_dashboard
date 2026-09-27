import type { Metadata } from 'next';
import { pageMeta } from '@/lib/seo';
import { INDUSTRY_ORDER, industry } from '@/content/industries';
import { IndustryPageBySlug } from '@/components/pages/Industries';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return INDUSTRY_ORDER.map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const slug = (await params).slug;
  const page = industry(slug);
  return pageMeta(`/industries/${slug}`, { title: page?.hero.title.ar ?? 'الحلول', description: page?.hero.lead.ar });
}

export default async function Page({ params }: Props) {
  return <IndustryPageBySlug slug={(await params).slug} />;
}
