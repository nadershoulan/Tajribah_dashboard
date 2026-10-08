/**
 * Rate limiting behind an interface, because the storage differs by environment and the
 * call sites must not care.
 *
 * §13.6: `/auth/refresh` is limited **per session** — a hash of the refresh cookie — not
 * per IP. Whole offices share an IP; limiting by IP either locks out a company or lets a
 * single stolen token retry freely.
 */
export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  /** Seconds until the window resets; goes straight into `Retry-After`. */
  retryAfter: number;
};

export interface RateLimiter {
  /** Count one hit against `key` and say whether it is allowed. */
  hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult>;
  reset(key: string): Promise<void>;
}

/**
 * In-process counters. Correct for a single process, which means: development, tests, and
 * nothing else. The plan's §8 forbids in-memory state in the API precisely because it stops
 * being true the moment there are two processes.
 */
export class MemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const now = Date.now();
    const existing = this.windows.get(key);

    if (!existing || existing.resetAt <= now) {
      const resetAt = now + windowSeconds * 1000;
      this.windows.set(key, { count: 1, resetAt });
      return { allowed: true, remaining: limit - 1, retryAfter: windowSeconds };
    }

    existing.count += 1;
    const retryAfter = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return {
      allowed: existing.count <= limit,
      remaining: Math.max(0, limit - existing.count),
      retryAfter,
    };
  }

  async reset(key: string): Promise<void> {
    this.windows.delete(key);
  }
}

/** The part of Workers' `KVNamespace` the limiter uses — structural, so tests need no runtime. */
export type RateLimitKv = {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
  delete(key: string): Promise<void>;
};

/**
 * Workers KV, shared by every isolate (P7: wired by `configureRateLimiter`). Eventually
 * consistent, so the count can lag by a second or two across colos — acceptable for abuse
 * control, never for anything that must be exact (a quota that costs money goes through
 * `assertWithinQuota` against the database instead).
 *
 *  - **A blocked hit writes nothing.** Once a key is over its limit the answer is read, not
 *    counted: a script hammering a blocked endpoint costs one KV read per request, not a write
 *    (writes are the metered, rate-limited half of KV).
 *  - **`retryAfter` is what is left of the window**, not its whole length.
 *  - `reset` clears the current window of every length the platform uses (LIMITS) — it once
 *    reached only minute and hour windows, so a login's 15-minute count survived it.
 */
export class KvRateLimiter implements RateLimiter {
  constructor(private readonly kv: RateLimitKv, private readonly now: () => number = Date.now) {}

  private slot(key: string, windowSeconds: number, at: number): { slot: string; retryAfter: number } {
    const ms = windowSeconds * 1000;
    const window = Math.floor(at / ms);
    return { slot: `rl:${key}:${windowSeconds}:${window}`, retryAfter: Math.max(1, Math.ceil(((window + 1) * ms - at) / 1000)) };
  }

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const { slot, retryAfter } = this.slot(key, windowSeconds, this.now());
    const seen = Number((await this.kv.get(slot)) ?? '0') || 0;
    if (seen >= limit) return { allowed: false, remaining: 0, retryAfter };
    const current = seen + 1;
    await this.kv.put(slot, String(current), { expirationTtl: Math.max(60, windowSeconds * 2) });
    return { allowed: true, remaining: Math.max(0, limit - current), retryAfter };
  }

  /** Clears the current window of `key` for every window length the platform uses (LIMITS). */
  async reset(key: string): Promise<void> {
    const at = this.now();
    const lengths = new Set(Object.values(LIMITS).map((rule) => rule.windowSeconds));
    await Promise.all([...lengths].map((seconds) => this.kv.delete(this.slot(key, seconds, at).slot)));
  }
}

/** The limits the auth flows use. Deliberately in one table so they can be read at a glance. */
export const LIMITS = {
  /** Per email + per IP. Slow enough to make credential stuffing pointless. */
  login: { limit: 10, windowSeconds: 15 * 60 },
  /** Per session (§13.6), not per IP. */
  refresh: { limit: 60, windowSeconds: 60 },
  passwordReset: { limit: 5, windowSeconds: 60 * 60 },
  /** Per store (P2.12): coupon codes cannot be guessed at speed. */
  couponCheck: { limit: 20, windowSeconds: 60 * 60 },
  /** Per user: each resend is an email to their inbox. */
  verifyResend: { limit: 5, windowSeconds: 60 * 60 },
  otpSend: { limit: 5, windowSeconds: 60 * 60 },
  otpVerify: { limit: 10, windowSeconds: 15 * 60 },
  register: { limit: 5, windowSeconds: 60 * 60 },
  /** Per person (P6, T30): every new store starts a free trial. */
  addStore: { limit: 5, windowSeconds: 24 * 60 * 60 },
  /** Per store (P7): each invitation is an email to someone's inbox — revoke-and-invite must not become a mailer. */
  invite: { limit: 20, windowSeconds: 60 * 60 },
  /** Per store (P7): each install check fetches a page from the shop (and asks DNS) — not a free crawler. */
  installCheck: { limit: 30, windowSeconds: 60 * 60 },
  /** Per sender's address (T115): the contact form is not a way to fill the inbox. */
  contact: { limit: 5, windowSeconds: 60 * 60 },
  /** Per store (P7): each export reads every day of the range; a report is not a polling target. */
  analyticsExport: { limit: 30, windowSeconds: 60 * 60 },
} as const;

let limiter: RateLimiter = new MemoryRateLimiter();

export function setRateLimiter(next: RateLimiter): void {
  limiter = next;
}

export function rateLimiter(): RateLimiter {
  return limiter;
}

/**
 * Install the limiter the environment names (P7). `memory` is per isolate — local only, and
 * refused in production by the env check; `kv` needs the `RATE_LIMITS` KV namespace bound.
 */
export function configureRateLimiter(config: { RATE_LIMITER?: 'memory' | 'kv' }, kv?: RateLimitKv): void {
  if (config.RATE_LIMITER !== 'kv') { limiter = new MemoryRateLimiter(); return; }
  if (!kv) throw new Error('RATE_LIMITER=kv but no KV namespace binding (RATE_LIMITS) is bound to this Worker');
  limiter = new KvRateLimiter(kv);
}
