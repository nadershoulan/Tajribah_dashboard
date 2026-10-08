/**
 * T115 — the website's contact form, kept in the database (`contact_messages`) instead of an email.
 *
 * In order, a message must: pass the rate limit (5 an hour per sender's address), leave the trap field empty
 * (a bot fills every field — it is told "sent" and nothing is kept), pass the field checks, and pass Cloudflare
 * Turnstile on the server. Only then is it saved, through the admin role (the app role has no grant).
 */
import { z } from 'zod';
import { unsafeAdminDb } from '@/db/client';
import { contactMessages } from '@/db/schema';
import { errors, fieldErrorsFrom } from '@/server/core/errors/problem';
import { LIMITS, rateLimiter } from '@/server/core/ratelimit/limiter';
import { foldDigits } from '@/lib/money';
import type { TurnstileVerifier } from '@/server/core/http/turnstile';

export const CONTACT_PLATFORMS = ['salla', 'zid', 'shopify', 'woocommerce', 'custom', 'other'] as const;

export const ContactInput = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().email().max(254),
  // Arabic-Indic digits folded to ASCII first (CLAUDE.md), then only digits, spaces, + ( ) -.
  phone: z.string().trim().max(30).transform(foldDigits).pipe(z.string().regex(/^[+0-9\s()-]*$/)).optional().transform((v) => v || null),
  store: z.string().trim().max(300).optional().transform((v) => v || null)
    .refine((v) => v === null || /^https?:\/\/[^\s]+\.[^\s]+/i.test(v), 'a web address starting with https://'),
  platform: z.enum(CONTACT_PLATFORMS).optional().transform((v) => v ?? null),
  message: z.string().trim().max(4000).optional().transform((v) => v ?? ''),
  lang: z.enum(['ar', 'en']).default('ar'),
  /** The trap: hidden from people, filled by bots. */
  website: z.string().max(500).optional(),
  token: z.string().max(2048).optional(),
});
export type ContactSubmission = z.input<typeof ContactInput>;

export type ContactDeps = {
  verify: TurnstileVerifier | null;
  /** Production without a Turnstile secret: refuse rather than take bots. */
  requireTurnstile: boolean;
  /** Keys the address hash so it cannot be reversed by trying every address. */
  hashKey: string;
};

async function ipHash(ip: string | null, key: string): Promise<string | null> {
  if (!ip) return null;
  const mac = await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', new TextEncoder().encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']), new TextEncoder().encode(`contact:${ip}`));
  return [...new Uint8Array(mac)].slice(0, 16).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** `stored: false` means the trap caught it: the sender is told it was sent, and nothing is kept. */
export async function submitContact(raw: unknown, meta: { ip: string | null; userAgent: string | null }, deps: ContactDeps): Promise<{ stored: boolean; id?: string }> {
  const limit = await rateLimiter().hit(`contact:${meta.ip ?? 'unknown'}`, LIMITS.contact.limit, LIMITS.contact.windowSeconds);
  if (!limit.allowed) throw errors.rateLimited(limit.retryAfter);
  const parsed = ContactInput.safeParse(raw);
  if (!parsed.success) throw errors.validation(fieldErrorsFrom(parsed.error.issues));
  const input = parsed.data;
  if (input.website && input.website.trim()) return { stored: false };

  if (deps.verify) {
    const verdict = await deps.verify(input.token ?? '', meta.ip);
    if (!verdict.ok) throw errors.validation({ token: ['the security check did not pass — please try it again'] });
  } else if (deps.requireTurnstile) {
    throw errors.notImplemented('the contact form’s security check is not set up yet (TURNSTILE_SECRET_KEY)');
  }

  const [row] = await unsafeAdminDb().insert(contactMessages).values({
    name: input.name, email: input.email, phone: input.phone, storeUrl: input.store, platform: input.platform,
    message: input.message, lang: input.lang, ipHash: await ipHash(meta.ip, deps.hashKey),
    userAgent: meta.userAgent ? meta.userAgent.slice(0, 300) : null,
  }).returning({ id: contactMessages.id });
  return { stored: true, id: row!.id };
}
