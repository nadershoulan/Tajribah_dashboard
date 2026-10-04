/**
 * Where a website file lives since the website moved into the platform (it was tajribah-try-on):
 * its code under `site/`, its pages under `app/(site)/`, its styles under `site/styles/`, its assets
 * in `public/`, and the proxy shared at the root. Tests name files as they were named in the website.
 */
import { join } from 'node:path';

export function sitePath(file: string): string {
  const root = process.cwd();
  if (file === 'proxy.ts' || file.startsWith('public/')) return join(root, file);
  if (file.startsWith('../tajribah-platform/')) return join(root, file.slice('../tajribah-platform/'.length));
  if (/^app\/(globals|site|theme)\.css$/.test(file)) return join(root, 'site', 'styles', file.slice(4));
  if (file.startsWith('app/api/')) return join(root, file);
  if (file === 'app' || file.startsWith('app/')) return join(root, 'app', '(site)', file.slice(4));
  return join(root, 'site', file);
}
