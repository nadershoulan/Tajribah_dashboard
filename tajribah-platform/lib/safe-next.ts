/**
 * `?next=` — where to go after signing in. Relative paths inside the dashboard only.
 *
 * `//evil.com` and `https://evil.com` are rejected, and so is anything with a backslash or a
 * control character: browsers normalise `\` to `/` and silently drop tabs and newlines, so
 * `/\t/evil.com` becomes `//evil.com` — an open redirect that no string check on `//` sees.
 * Lives in `lib/` because the sign-in screen and the server both need it.
 */
const UNSAFE = /[\u0000-\u001f\u007f\\]/;

export function safeNext(next: string | null | undefined, fallback = '/dashboard'): string {
  if (!next) return fallback;
  if (!next.startsWith('/')) return fallback;
  if (UNSAFE.test(next)) return fallback;
  if (next.startsWith('//')) return fallback;
  if (/^\/api\//.test(next)) return fallback;
  return next;
}
