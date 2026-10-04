/** The website's pages, as the proxy knows them, are exactly the pages under app/(site). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SITE_PAGES, isSitePath } from '@/lib/site-paths';

function pages(dir: string, at = ''): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) found.push(...pages(full, `${at}/${entry}`));
    else if (entry === 'page.tsx') found.push(at || '/');
  }
  return found;
}

test('every page under app/(site) is listed, and nothing else', () => {
  const onDisk = pages(join(process.cwd(), 'app', '(site)')).sort();
  const listed = SITE_PAGES.filter((p) => !p.endsWith('.txt') && !p.endsWith('.xml')).sort();
  assert.deepEqual(listed, onDisk);
});

test('website paths get the website policy; the dashboard’s, including /salla/app, do not', () => {
  for (const path of ['/', '/pricing', '/pricing/', '/blog/launch', '/p/oud/sa-77', '/embed/try-on', '/robots.txt', '/salla']) assert.equal(isSitePath(path), true, path);
  for (const path of ['/dashboard', '/login', '/admin/site', '/salla/app', '/blog/a/b', '/p/oud', '/pricingx', '/register']) assert.equal(isSitePath(path), false, path);
});
