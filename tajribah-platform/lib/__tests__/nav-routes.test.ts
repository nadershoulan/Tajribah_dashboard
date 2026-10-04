/**
 * T52 — every sidebar and palette entry opens a real screen. "QR codes" was listed from the start
 * and led to "page not found"; a screen that waits on something says why on its own page.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ALL_NAV } from '@/lib/nav';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTES, hasScreen } from '@/components/routes';

test('every sidebar entry has a screen of its own', () => {
  const missing = ALL_NAV.map((item) => item.href).filter((href) => !ROUTES[href]);
  assert.deepEqual(missing, [], 'these would open "page not found"');
});

/** Every .tsx under components/. */
function screens(dir = join(process.cwd(), 'components'), found: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) screens(full, found);
    else if (entry.endsWith('.tsx')) found.push(full);
  }
  return found;
}

test('every in-app link and navigation written out in a screen opens a screen', () => {
  // "Add a product by hand" on Products led to /dashboard/products/new, which had no screen.
  const dead: string[] = [];
  let seen = 0;
  for (const file of screens()) {
    const source = readFileSync(file, 'utf8');
    for (const [, path] of source.matchAll(/(?:href=|navigate\()["'](\/(?:dashboard|admin)[^"'`${}]*)["']/g)) {
      seen++;
      if (!hasScreen(path!)) dead.push(`${file.slice(process.cwd().length + 1)}: ${path}`);
    }
  }
  assert.ok(seen > 30, `the scan finds the links (${seen})`);
  assert.deepEqual(dead, [], 'these open "page not found"');
});
