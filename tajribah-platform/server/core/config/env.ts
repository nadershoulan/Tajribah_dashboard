/**
 * P0.2 — the environment registry.
 *
 * Every variable the platform reads is declared here once, with its scope, whether it is a
 * secret, and what it is for. `.env.example` is generated from this registry
 * (`node scripts/gen-env-example.mjs`) rather than hand-edited, so the template cannot
 * silently omit a variable — §13.6.
 *
 * Boot fails loudly and completely: a missing or malformed variable throws with every
 * problem listed, not the first one.
 */
import { z } from 'zod';

type Scope = 'runtime' | 'build' | 'worker';

type Entry = {
  schema: z.ZodTypeAny;
  scope: Scope;
  secret?: boolean;
  /** What it is for, in one line. This becomes the comment in .env.example. */
  doc: string;
  /** Shown in .env.example. Never a real credential. */
  example?: string;
};

const entry = (e: Entry) => e;

export const REGISTRY = {
  NODE_ENV: entry({
    schema: z.enum(['development', 'test', 'production']).default('development'),
    scope: 'runtime', doc: 'Runtime mode.', example: 'development',
  }),
  APP_URL: entry({
    schema: z.string().url(),
    scope: 'runtime', doc: 'Public origin of the dashboard. Used for links in email and the ?next= allow-list.',
    example: 'http://localhost:5173',
  }),
  AUTH_SECRET: entry({
    schema: z.string().min(32),
    scope: 'runtime', secret: true,
    doc: 'HMAC key for access tokens. 32+ bytes of randomness. Rotating it logs everyone out.',
    example: 'generate-with-openssl-rand-base64-48',
  }),
  ENCRYPTION_KEY: entry({
    schema: z.string().min(32),
    scope: 'runtime', secret: true,
    doc: 'AES-256-GCM key for store connection tokens at rest (§7.5). Domain-separated from AUTH_SECRET.',
    example: 'generate-with-openssl-rand-base64-48',
  }),
  ENCRYPTION_KEY_PREVIOUS: entry({
    schema: z.string().min(32).optional(),
    scope: 'runtime', secret: true,
    doc: 'Only while rotating ENCRYPTION_KEY: the old key, so tokens it sealed still open. The worker re-seals them; remove it once none are left.',
  }),
  SESSION_TTL_MINUTES: entry({
    schema: z.coerce.number().int().positive().default(15),
    scope: 'runtime', doc: 'Access token lifetime. The refresh token outlives it and rotates.',
  }),
  REFRESH_TTL_DAYS: entry({
    schema: z.coerce.number().int().positive().default(30),
    scope: 'runtime', doc: 'Refresh token lifetime.',
  }),
  EMAIL_PROVIDER: entry({
    schema: z.enum(['console', 'resend']).default('console'),
    scope: 'runtime', doc: 'console prints to the log in development; resend needs RESEND_API_KEY.',
  }),
  RESEND_API_KEY: entry({
    schema: z.string().optional(),
    scope: 'runtime', secret: true, doc: 'Required when EMAIL_PROVIDER=resend.',
  }),
  EMAIL_FROM: entry({
    schema: z.string().optional(),
    scope: 'runtime', doc: 'Sender address, on a domain verified in Resend. Required when EMAIL_PROVIDER=resend.',
    example: 'Tajribah <no-reply@example.com>',
  }),
  SMS_PROVIDER: entry({
    schema: z.enum(['console', 'unifonic', 'none']).default('console'),
    scope: 'runtime', doc: 'Phone OTP transport. Production must not be console. none: this version sends no SMS (T110, Unifonic moved to version 2); any attempt fails loudly.',
  }),
  UNIFONIC_APP_SID: entry({
    schema: z.string().optional(),
    scope: 'runtime', secret: true, doc: 'Required when SMS_PROVIDER=unifonic.',
  }),
  UNIFONIC_SENDER_ID: entry({
    schema: z.string().max(11).optional(),
    scope: 'runtime', doc: 'Registered alphanumeric sender name (CST-approved, max 11). Required when SMS_PROVIDER=unifonic.',
  }),
  SALLA_CLIENT_ID: entry({
    schema: z.string().optional(), scope: 'runtime',
    doc: 'Salla partner app. Blocks the P1 core loop until the partner account exists (§12.1).',
  }),
  SALLA_CLIENT_SECRET: entry({
    schema: z.string().optional(), scope: 'runtime', secret: true, doc: 'Salla partner app secret.',
  }),
  SALLA_APP_ID: entry({
    schema: z.string().regex(/^\d{1,20}$/, 'the numeric app id from the Salla Partners portal').optional(), scope: 'runtime',
    doc: 'The Salla app id (Partners portal). Verifies the app page’s session token with Salla (introspect, T61); without it a Salla store cannot be linked.',
  }),
  SALLA_WEBHOOK_SECRET: entry({
    schema: z.string().optional(), scope: 'runtime', secret: true,
    doc: 'Verifies webhook signatures against the raw body (§13.6).',
  }),
  CUSTOM_DOMAIN_TARGET: entry({
    schema: z.string().regex(/^[a-z0-9.-]+\.[a-z]{2,}$/, 'a hostname').optional(), scope: 'runtime',
    doc: 'Where Enterprise stores point their own address (CNAME) — the Cloudflare for SaaS fallback origin (T62). Default domains.tajribah.org.',
  }),
  HOSTED_PAGE_BASE: entry({
    schema: z.string().regex(/^(?:https:\/\/[a-z0-9.-]+\.[a-z]{2,}|http:\/\/(?:localhost|127\.0\.0\.1|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})(?::\d{2,5})?)(?:\/[a-z0-9-]+)*$/, 'an https address (http only on this machine or its Wi-Fi address), no trailing slash').optional(), scope: 'runtime',
    doc: 'Where products’ own pages live (P1.19): {base}/{store}/{product}. Default https://tajribah.org/p — set to the short domain before launch; locally, the website’s dev address.',
  }),
  CLOUDFLARE_SAAS_ZONE_ID: entry({
    schema: z.string().regex(/^[0-9a-f]{32}$/, 'a Cloudflare zone id (32 hex characters)').optional(), scope: 'runtime',
    doc: 'The Cloudflare zone that serves stores’ own addresses (Cloudflare for SaaS, T62). Unset: a ready address stays ready.',
  }),
  CLOUDFLARE_SAAS_API_TOKEN: entry({
    schema: z.string().optional(), scope: 'runtime', secret: true,
    doc: 'A Cloudflare API token allowed to edit that zone’s custom hostnames (SSL and Certificates: Edit).',
  }),
  ZID_CLIENT_ID: entry({
    schema: z.string().regex(/^\d{1,20}$/, 'the numeric client id from the Zid Partner dashboard').optional(), scope: 'runtime',
    doc: 'The Tajribah app in the Zid Partner dashboard (T61). Unset: Zid stores cannot be connected yet.',
  }),
  ZID_CLIENT_SECRET: entry({
    schema: z.string().optional(), scope: 'runtime', secret: true,
    doc: 'The Zid app secret: exchanges the install code and refreshes stores’ tokens.',
  }),
  DATABASE_APP_URL: entry({
    schema: z.string().regex(/^postgres(ql)?:\/\//, 'a postgres:// address').optional(), scope: 'runtime', secret: true,
    doc: 'P0.20: the login for the tajribah_app role (row-level security applies). On Cloudflare a Hyperdrive binding HYPERDRIVE_APP takes its place.',
  }),
  DATABASE_ADMIN_URL: entry({
    schema: z.string().regex(/^postgres(ql)?:\/\//, 'a postgres:// address').optional(), scope: 'runtime', secret: true,
    doc: 'P0.20: the login for the tajribah_admin role (BYPASSRLS on the login itself). On Cloudflare a Hyperdrive binding HYPERDRIVE_ADMIN takes its place.',
  }),
  SHOPIFY_CLIENT_ID: entry({
    schema: z.string().optional(), scope: 'runtime',
    doc: 'The Tajribah app in the Shopify Partner dashboard (P6). Unset: Shopify cannot be connected yet.',
  }),
  SHOPIFY_CLIENT_SECRET: entry({
    schema: z.string().optional(), scope: 'runtime', secret: true,
    doc: 'The Shopify app secret: signs the install callback (HMAC) and exchanges its code for the shop token.',
  }),
  GOOGLE_CLIENT_ID: entry({
    schema: z.string().regex(/^[0-9a-z-]+\.apps\.googleusercontent\.com$/, 'an OAuth client id ending .apps.googleusercontent.com').optional(), scope: 'runtime',
    doc: 'T69: a Google Cloud OAuth client (web application) with the Google Analytics Admin API on; redirect {APP_URL}/api/google/callback. Unset: GA4 ids are pasted, not picked after a Google sign-in.',
  }),
  GOOGLE_CLIENT_SECRET: entry({
    schema: z.string().optional(), scope: 'runtime', secret: true,
    doc: 'T69: that OAuth client’s secret: exchanges the sign-in code (read-only Analytics access, used once, never stored).',
  }),
  CDN_BASE_URL: entry({
    schema: z.string().url().optional(), scope: 'runtime',
    doc: 'Public base for R2 assets. Models and textures are served from here, never from the app.',
    example: 'https://cdn.example.com',
  }),
  STORAGE_PROVIDER: entry({
    schema: z.enum(['memory', 'r2', 's3']).default('memory'),
    scope: 'runtime', doc: 'memory keeps files in-process (local only, lost on restart). r2 uses the BUCKET binding (the Worker). s3 uses the S3 API with the R2_* keys (the Node worker, T57). Both need CDN_BASE_URL.',
  }),
  S3_ENDPOINT: entry({
    schema: z.string().url().optional(), scope: 'runtime',
    doc: 'T57: with STORAGE_PROVIDER=s3, the S3 endpoint (default: R2\'s, from R2_ACCOUNT_ID). Another only for a local S3 server such as MinIO.',
  }),
  S3_REGION: entry({
    schema: z.string().optional(), scope: 'runtime', doc: 'T57: the S3 signing region (R2: auto, the default).',
  }),
  R2_ACCOUNT_ID: entry({
    schema: z.string().optional(), scope: 'runtime',
    doc: 'Cloudflare account id. With the three below it enables presigned direct-to-R2 uploads.',
  }),
  R2_BUCKET_NAME: entry({
    schema: z.string().optional(), scope: 'runtime', doc: 'The bucket the BUCKET binding points at.',
  }),
  R2_ACCESS_KEY_ID: entry({
    schema: z.string().optional(), scope: 'runtime', secret: true, doc: 'R2 S3 API token id (Object Read & Write, this bucket only).',
  }),
  R2_SECRET_ACCESS_KEY: entry({
    schema: z.string().optional(), scope: 'runtime', secret: true, doc: 'R2 S3 API token secret.',
  }),
  CONFIG_STORE: entry({
    schema: z.enum(['memory', 'kv']).default('memory'),
    scope: 'runtime', doc: 'Where published viewer configs live (P1.15). memory is local only; kv uses the CONFIGS KV binding the config host reads.',
  }),
  RATE_LIMITER: entry({
    schema: z.enum(['memory', 'kv']).default('memory'),
    scope: 'runtime', doc: 'Where rate-limit counters live (P7). memory counts per isolate (local only); kv uses the RATE_LIMITS KV binding, shared by every isolate.',
  }),
  JOBS_MODE: entry({
    schema: z.enum(['inline', 'cf-queue']).default('inline'),
    scope: 'runtime', doc: 'How new jobs wake a worker (T6, P7). inline: they wait for the every-minute pass (local only). cf-queue: each also nudges the JOBS queue binding, whose consumer runs them within seconds.',
  }),
  LOG_LEVEL: entry({
    schema: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    scope: 'runtime', doc: 'Minimum level written to the structured log.',
  }),
} satisfies Record<string, Entry>;

export type EnvName = keyof typeof REGISTRY;

const shape = Object.fromEntries(
  Object.entries(REGISTRY).map(([name, e]) => [name, e.schema]),
) as { [K in EnvName]: (typeof REGISTRY)[K]['schema'] };

const envSchema = z.object(shape).superRefine((value, ctx) => {
  const v = value as Record<string, unknown>;
  const need = (when: boolean, name: EnvName, why: string) => {
    if (when && !v[name]) ctx.addIssue({ code: z.ZodIssueCode.custom, path: [name], message: why });
  };
  need(v.EMAIL_PROVIDER === 'resend', 'RESEND_API_KEY', 'required when EMAIL_PROVIDER=resend');
  need(v.EMAIL_PROVIDER === 'resend', 'EMAIL_FROM', 'required when EMAIL_PROVIDER=resend');
  need(v.SMS_PROVIDER === 'unifonic', 'UNIFONIC_APP_SID', 'required when SMS_PROVIDER=unifonic');
  need(v.SMS_PROVIDER === 'unifonic', 'UNIFONIC_SENDER_ID', 'required when SMS_PROVIDER=unifonic');
  need(!!v.SALLA_CLIENT_ID, 'SALLA_CLIENT_SECRET', 'required when SALLA_CLIENT_ID is set');
  need(!!v.SHOPIFY_CLIENT_ID, 'SHOPIFY_CLIENT_SECRET', 'required when SHOPIFY_CLIENT_ID is set');
  need(!!v.ZID_CLIENT_ID, 'ZID_CLIENT_SECRET', 'required when ZID_CLIENT_ID is set');
  need(!!v.GOOGLE_CLIENT_ID, 'GOOGLE_CLIENT_SECRET', 'required when GOOGLE_CLIENT_ID is set');
  need(!!v.CLOUDFLARE_SAAS_ZONE_ID, 'CLOUDFLARE_SAAS_API_TOKEN', 'required when CLOUDFLARE_SAAS_ZONE_ID is set');
  need(!!v.DATABASE_APP_URL, 'DATABASE_ADMIN_URL', 'required when DATABASE_APP_URL is set — one login per role');
  need(!!v.DATABASE_ADMIN_URL, 'DATABASE_APP_URL', 'required when DATABASE_ADMIN_URL is set — one login per role');
  // §12.6: the API must not boot in production pretending it can send an OTP. `none` (T110) is honest: it
  // says no SMS is sent, and a send fails loudly; `console` would pretend.
  if (v.NODE_ENV === 'production' && v.SMS_PROVIDER === 'console') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMS_PROVIDER'],
      message: 'console SMS is not allowed in production — phone verification would silently no-op' });
  }
  need(v.STORAGE_PROVIDER === 'r2', 'CDN_BASE_URL', 'required when STORAGE_PROVIDER=r2');
  for (const name of ['CDN_BASE_URL', 'R2_BUCKET_NAME', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY'] as const) need(v.STORAGE_PROVIDER === 's3', name, 'required when STORAGE_PROVIDER=s3');
  need(v.STORAGE_PROVIDER === 's3' && !v.S3_ENDPOINT, 'R2_ACCOUNT_ID', 'required when STORAGE_PROVIDER=s3 without S3_ENDPOINT');
  if (v.NODE_ENV === 'production' && v.STORAGE_PROVIDER === 'memory') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['STORAGE_PROVIDER'],
      message: 'memory storage is not allowed in production — every upload would vanish on restart' });
  }
  if (v.NODE_ENV === 'production' && v.CONFIG_STORE === 'memory') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['CONFIG_STORE'],
      message: 'memory configs are not allowed in production — a published button would never reach a shop' });
  }
  if (v.NODE_ENV === 'production' && v.RATE_LIMITER === 'memory') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['RATE_LIMITER'],
      message: 'memory rate limits are not allowed in production — each isolate would count alone, so no limit would hold' });
  }
  if (v.NODE_ENV === 'production' && v.JOBS_MODE === 'inline') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['JOBS_MODE'],
      message: 'inline jobs are not allowed in production — new work would wait up to a minute for the cron pass' });
  }
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/** Parse and cache. Throws once, listing every problem. */
export function loadEnv(source: Record<string, string | undefined> = readSource()): Env {
  if (cached) return cached;
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new Error(`Invalid environment:\n${lines.join('\n')}\n\nSee .env.example (generated from server/core/config/env.ts).`);
  }
  cached = parsed.data;
  return cached;
}

/** Tests only: forget the cached parse. */
export function resetEnv(): void {
  cached = null;
}

function readSource(): Record<string, string | undefined> {
  // Workers put bindings on the module-scoped env; Node puts them on process.env.
  const fromNode = typeof process !== 'undefined' ? process.env : undefined;
  return (fromNode ?? {}) as Record<string, string | undefined>;
}
