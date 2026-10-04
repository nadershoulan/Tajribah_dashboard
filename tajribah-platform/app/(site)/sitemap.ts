import type { MetadataRoute } from 'next';
import { COMPANY, TITLES } from '@site/lib/site';
import { HELP_ARTICLES } from '@site/content/help';
import { BLOG_POSTS } from '@site/content/blog';

/** M12 — every public page, help article and blog post. Both languages share one URL (cookie). */
export default function sitemap(): MetadataRoute.Sitemap {
  const base = COMPANY.siteUrl;
  const pages = Object.keys(TITLES).map((path) => ({
    url: `${base}${path === '/' ? '' : path}`,
    changeFrequency: 'monthly' as const,
    priority: path === '/' ? 1 : ['/salla', '/zid', '/pricing', '/demo'].includes(path) ? 0.8 : 0.6,
  }));
  const help = HELP_ARTICLES.map((a) => ({ url: `${base}/help/${a.slug}`, lastModified: a.updated, changeFrequency: 'monthly' as const, priority: 0.5 }));
  const blog = BLOG_POSTS.map((p) => ({ url: `${base}/blog/${p.slug}`, lastModified: p.date, changeFrequency: 'yearly' as const, priority: 0.5 }));
  return [...pages, ...help, ...blog];
}
