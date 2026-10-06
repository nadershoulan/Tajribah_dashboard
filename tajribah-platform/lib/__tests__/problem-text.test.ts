/**
 * The server's refusals in Arabic when the dashboard is in Arabic: every fixed line a merchant-facing
 * module can send has its Arabic (read from the source, so a new line without one fails here), the
 * worded ones too, and what is not known falls back to Arabic — never to English.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { ApiError } from '@/lib/api-client';
import { ARABIC_FALLBACK, arabicOf, inArabic, sayProblem } from '@/lib/problem-text';

const MERCHANT = ['tryon', 'products', 'ar', 'edge', 'connections', 'sync', 'uploads', 'models', 'hosted-pages', 'team', 'onboarding', 'professional', 'auth', 'dashboard', 'settings'];
const files = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
  const path = join(dir, f);
  if (statSync(path).isDirectory()) return f === '__tests__' ? [] : files(path);
  return path.endsWith('.ts') ? [path] : [];
});

test('every fixed refusal a merchant can meet has its Arabic', () => {
  const lines = new Set<string>();
  for (const name of MERCHANT) {
    const dir = join(process.cwd(), 'server', 'modules', name);
    try { statSync(dir); } catch { continue; }
    for (const file of files(dir)) {
      for (const m of readFileSync(file, 'utf8').matchAll(/errors\.(conflict|forbidden|notFound)\('([^'$]{3,220})'\)/g)) {
        lines.add(m[1] === 'notFound' ? `${m[2]} not found` : m[2]!);
      }
    }
  }
  assert.ok(lines.size > 40, `read ${lines.size} lines`);
  const missing = [...lines].filter((line) => !arabicOf(line));
  assert.deepEqual(missing, [], 'each has its Arabic in lib/problem-text.ts');
});

test('worded refusals keep their numbers and names, in Arabic', () => {
  assert.equal(arabicOf('finish the try-on first: add its try-on picture and its width'), 'أكمل التجربة أولًا: أضف صورة التجربة والمقاس.');
  assert.equal(arabicOf('not enough AI credits: 3 left, 10 needed'), 'رصيدك لا يكفي: بقي 3 ويلزم 10.');
  assert.equal(arabicOf('plan limit reached for products (200)'), 'بلغت حد باقتك (200). رقِّ باقتك للمزيد.');
  assert.equal(arabicOf('the feed answered 404'), 'ردّ رابط ملف المنتجات بالرمز 404 — تأكد أن الرابط صحيح وما زال يعمل.');
  assert.equal(arabicOf('sync failed: the feed did not answer'), 'فشلت المزامنة: لم يُجب رابط ملف المنتجات — حاول بعد قليل.');
  assert.equal(arabicOf('product not found'), 'المنتج غير موجود.');
  assert.equal(arabicOf('missing permission: tryon:write'), 'دورك في الفريق لا يسمح بهذا.');
  assert.equal(arabicOf('is not ours at all'), null);
});

test('in Arabic, never English: the line, else the fields, else the kind’s title; in English, the server’s line', () => {
  const known = new ApiError(409, 'conflict', 'this product is not published');
  assert.equal(sayProblem(known, 'ar'), 'هذا المنتج غير منشور.');
  assert.equal(sayProblem(known, 'en'), 'this product is not published');
  const fields = new ApiError(422, 'validation_failed', 'Validation failed', { worn: ['has no transparency — save the cut-out as a PNG or WebP with a transparent background'] });
  assert.match(sayProblem(fields, 'ar'), /بلا شفافية/);
  const unknown = new ApiError(403, 'forbidden', 'staff only: the console needs a second step');
  assert.equal(sayProblem(unknown, 'ar'), 'لا تملك صلاحية لهذا');
  assert.equal(sayProblem(new ApiError(500, 'weird_code', 'boom'), 'ar'), ARABIC_FALLBACK);
  assert.equal(sayProblem(new Error('لا صورة'), 'ar'), 'لا صورة', 'a screen’s own Arabic stays');
  assert.doesNotMatch(sayProblem(new ApiError(409, 'conflict', 'something new and English'), 'ar'), /[A-Za-z]/);
});

test('a screen’s own list had no words: ours, then a plain Arabic line — its Arabic kept as it is', () => {
  assert.equal(inArabic('this product is not published'), 'هذا المنتج غير منشور.');
  assert.equal(inArabic('a brand new English refusal'), ARABIC_FALLBACK);
  assert.equal(inArabic('رسالة بالعربية'), 'رسالة بالعربية');
});

test('T95: every reason the install checker gives for a page (and its Tag Manager container) has its Arabic', () => {
  const lines = new Set<string>();
  for (const file of ['service.ts'].map((f) => join(process.cwd(), 'server', 'modules', 'embed', f))) {
    for (const m of readFileSync(file, 'utf8').matchAll(/detail: '([^']{3,200})'/g)) lines.add(m[1]!);
  }
  lines.add('preview — the real app fetches the page and checks it'); // the preview's own answer (lib/data.tsx)
  assert.ok(lines.size >= 6, `read the checker’s lines: ${[...lines].join(' | ')}`);
  for (const line of lines) assert.ok(arabicOf(line), `no Arabic for the checker’s "${line}"`);
  assert.match(arabicOf('the page answered 403')!, /403/);
  assert.match(arabicOf('redirected somewhere we will not follow: must be a domain name, not an IP address')!, /تحوّل/);
});
