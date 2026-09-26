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

/**
 * Workers KV. Eventually consistent, so the count can lag by a second or two across
 * colos — acceptable for abuse control, never for anything that must be exact (a quota
 * that costs money goes through `assertWithinQuota` against the database instead).
 */
export class KvRateLimiter implements RateLimiter {
  constructor(private readonly kv: KVNamespace) {}

  async hit(key: string, limit: number, windowSeconds: number): Promise<RateLimitResult> {
    const window = Math.floor(Date.now() / (windowSeconds * 1000));
    const slot = `rl:${key}:${window}`;
    const current = Number((await this.kv.get(slot)) ?? '0') + 1;
    await this.kv.put(slot, String(current), { expirationTtl: Math.max(60, windowSeconds * 2) });
    return {
      allowed: current <= limit,
      remaining: Math.max(0, limit - current),
      retryAfter: windowSeconds,
    };
  }

  async reset(key: string): Promise<void> {
    // Windowed keys expire on their own; an explicit reset only clears the current window.
    const windows = [Math.floor(Date.now() / 60_000), Math.floor(Date.now() / 3_600_000)];
    await Promise.all(windows.map((w) => this.kv.delete(`rl:${key}:${w}`)));
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
} as const;

let limiter: RateLimiter = new MemoryRateLimiter();

export function setRateLimiter(next: RateLimiter): void {
  limiter = next;
}

export function rateLimiter(): RateLimiter {
  return limiter;
}
