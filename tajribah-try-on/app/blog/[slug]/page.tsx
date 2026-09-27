import type { Metadata } from 'next';
import { BLOG_POSTS, blogPost } from '@/content/blog';
import { BlogPostPage } from '@/components/pages/Resources';

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return BLOG_POSTS.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const post = blogPost((await params).slug);
  return { title: post?.title.ar ?? 'المدونة', description: post?.excerpt.ar };
}

export default async function Page({ params }: Props) {
  return <BlogPostPage slug={(await params).slug} />;
}
