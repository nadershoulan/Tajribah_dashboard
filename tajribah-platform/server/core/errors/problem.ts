/**
 * P0.3 — the error model. RFC 9457 `application/problem+json` for every failure.
 *
 * Two rules here are security properties, not style:
 *  - Every credential failure produces the identical problem (§13.6). Unknown email, wrong
 *    password and "not a member of this tenant" must be indistinguishable to the caller.
 *  - A resource belonging to another tenant is `not_found`, never `forbidden`. Telling the
 *    caller that the id exists is the leak.
 */
import type { Lang } from '@/lib/lang';

export type ErrorCode =
  | 'validation_failed' | 'invalid_credentials' | 'unauthenticated' | 'forbidden'
  | 'not_found' | 'conflict' | 'idempotency_conflict' | 'rate_limited'
  | 'quota_exceeded' | 'plan_required' | 'upstream_unavailable' | 'upstream_timeout'
  | 'not_implemented' | 'internal';

type Def = { status: number; title: { ar: string; en: string } };

const CATALOGUE: Record<ErrorCode, Def> = {
  validation_failed:    { status: 422, title: { ar: 'بيانات غير صالحة', en: 'Validation failed' } },
  invalid_credentials:  { status: 401, title: { ar: 'بيانات الدخول غير صحيحة', en: 'Invalid credentials' } },
  unauthenticated:      { status: 401, title: { ar: 'يلزم تسجيل الدخول', en: 'Authentication required' } },
  forbidden:            { status: 403, title: { ar: 'لا تملك صلاحية', en: 'Not permitted' } },
  not_found:            { status: 404, title: { ar: 'غير موجود', en: 'Not found' } },
  conflict:             { status: 409, title: { ar: 'تعارض', en: 'Conflict' } },
  idempotency_conflict: { status: 409, title: { ar: 'طلب مكرر بمحتوى مختلف', en: 'Idempotency key reused with a different body' } },
  rate_limited:         { status: 429, title: { ar: 'محاولات كثيرة', en: 'Too many requests' } },
  quota_exceeded:       { status: 409, title: { ar: 'تجاوزت حد الباقة', en: 'Plan quota exceeded' } },
  plan_required:        { status: 402, title: { ar: 'يتطلب ترقية الباقة', en: 'Upgrade required' } },
  upstream_unavailable: { status: 502, title: { ar: 'خدمة خارجية غير متاحة', en: 'Upstream unavailable' } },
  upstream_timeout:     { status: 504, title: { ar: 'انتهت مهلة الخدمة الخارجية', en: 'Upstream timed out' } },
  not_implemented:      { status: 501, title: { ar: 'غير متاح بعد', en: 'Not implemented' } },
  internal:             { status: 500, title: { ar: 'خطأ غير متوقع', en: 'Unexpected error' } },
};

export type FieldErrors = Record<string, string[]>;

export type ProblemDocument = {
  type: string;
  title: string;
  status: number;
  code: ErrorCode;
  detail?: string;
  instance?: string;
  requestId?: string;
  errors?: FieldErrors;
  /** Seconds to wait; only on rate_limited. */
  retryAfter?: number;
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly errors?: FieldErrors;
  readonly retryAfter?: number;
  /** Logged, never sent: the real reason behind a deliberately vague public message. */
  readonly internal?: string;

  constructor(code: ErrorCode, options: {
    detail?: string; errors?: FieldErrors; retryAfter?: number; internal?: string; cause?: unknown;
  } = {}) {
    super(options.detail ?? code, { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = CATALOGUE[code].status;
    this.errors = options.errors;
    this.retryAfter = options.retryAfter;
    this.internal = options.internal;
  }
}

/** Helpers that read as sentences at the call site. */
export const errors = {
  validation: (fields: FieldErrors, detail?: string) =>
    new AppError('validation_failed', { errors: fields, detail }),
  /** Every login failure. Never say which half was wrong — `internal` is for the log only. */
  credentials: (internal: string) => new AppError('invalid_credentials', { internal }),
  unauthenticated: (detail?: string) => new AppError('unauthenticated', { detail }),
  forbidden: (detail?: string) => new AppError('forbidden', { detail }),
  /** Also the answer for "exists, but belongs to another tenant". */
  notFound: (what = 'resource') => new AppError('not_found', { detail: `${what} not found` }),
  conflict: (detail: string) => new AppError('conflict', { detail }),
  quota: (metric: string, limit: number) =>
    new AppError('quota_exceeded', { detail: `plan limit reached for ${metric} (${limit})` }),
  planRequired: (feature: string) =>
    new AppError('plan_required', { detail: `${feature} is not included in this plan` }),
  rateLimited: (retryAfter: number) => new AppError('rate_limited', { retryAfter }),
  upstream: (provider: string, cause?: unknown) =>
    new AppError('upstream_unavailable', { detail: `${provider} is unavailable`, cause }),
  notImplemented: (what: string) => new AppError('not_implemented', { detail: what }),
};

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export function toProblem(
  error: unknown,
  ctx: { requestId?: string; instance?: string; lang?: Lang } = {},
): ProblemDocument {
  const lang = ctx.lang ?? 'ar';
  const app = isAppError(error) ? error : new AppError('internal', { cause: error });
  const def = CATALOGUE[app.code];
  return {
    type: `https://tajribah.sa/problems/${app.code}`,
    title: def.title[lang],
    status: def.status,
    code: app.code,
    // An unexpected error never explains itself to the caller; the log keeps the detail.
    detail: app.code === 'internal' ? undefined : app.message || undefined,
    instance: ctx.instance,
    requestId: ctx.requestId,
    errors: app.errors,
    retryAfter: app.retryAfter,
  };
}

export function problemResponse(error: unknown, ctx: Parameters<typeof toProblem>[1] = {}): Response {
  const problem = toProblem(error, ctx);
  const headers: Record<string, string> = { 'content-type': 'application/problem+json; charset=utf-8' };
  if (problem.retryAfter !== undefined) headers['retry-after'] = String(problem.retryAfter);
  if (ctx.requestId) headers['x-request-id'] = ctx.requestId;
  return new Response(JSON.stringify(problem), { status: problem.status, headers });
}

/** zod issues → field errors, flattened the way forms want them. */
export function fieldErrorsFrom(issues: readonly { path: readonly (string | number)[]; message: string }[]): FieldErrors {
  const out: FieldErrors = {};
  for (const issue of issues) {
    const key = issue.path.join('.') || '_';
    (out[key] ??= []).push(issue.message);
  }
  return out;
}
