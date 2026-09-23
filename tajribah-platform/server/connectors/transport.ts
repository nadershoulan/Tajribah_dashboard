/**
 * P1.3 — outbound HTTP to a store's API, built to survive the store having a bad day.
 *
 *  - **Timeout.** Every call is aborted after `timeoutMs`; a hung upstream never holds a
 *    worker.
 *  - **Retry.** Only where retrying is safe (idempotent methods, or a request the upstream
 *    never received) and only for transient answers: network errors, timeouts, 429, 502,
 *    503, 504. Exponential backoff with full jitter; a `Retry-After` from the store wins.
 *  - **Circuit breaker, per connection.** After `failureThreshold` consecutive failures the
 *    circuit opens and calls fail fast for `cooldownMs` — a store that is down is not
 *    hammered by every sync job that wakes up. Then one trial call decides.
 *  - **Rate limit, per connection.** A token bucket sized to the provider's published limit,
 *    so one merchant's full sync never spends another merchant's quota on a shared app.
 *
 * Clock, sleep and fetch are injected, so every behaviour is tested without real waiting.
 */
import { AppError, errors } from '../core/errors/problem';
import { log } from '../core/observability/log';

export type TransportOptions = {
  timeoutMs?: number;
  maxAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  failureThreshold?: number;
  cooldownMs?: number;
  /** Requests per `perMs` for one connection. */
  rate?: { requests: number; perMs: number };
  /** The longest a call waits for a rate-limit slot before giving up. */
  maxQueueMs?: number;
};

export type Clock = { now(): number; sleep(ms: number): Promise<void>; random(): number };

export const realClock: Clock = {
  now: () => Date.now(),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random: () => Math.random(),
};

const DEFAULTS: Required<TransportOptions> = {
  timeoutMs: 10_000,
  maxAttempts: 4,
  baseDelayMs: 250,
  maxDelayMs: 8_000,
  failureThreshold: 5,
  cooldownMs: 30_000,
  rate: { requests: 60, perMs: 60_000 },
  maxQueueMs: 15_000,
};

const TRANSIENT_STATUS = new Set([429, 502, 503, 504]);
const IDEMPOTENT = new Set(['GET', 'HEAD', 'OPTIONS', 'PUT', 'DELETE']);

type Circuit = { failures: number; openedAt: number | null; trialInFlight: boolean };
type Bucket = { tokens: number; updatedAt: number };

export class Transport {
  private readonly options: Required<TransportOptions>;
  private readonly circuits = new Map<string, Circuit>();
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    readonly provider: string,
    options: TransportOptions = {},
    private readonly fetchImpl: typeof fetch = (...args) => fetch(...args),
    private readonly clock: Clock = realClock,
  ) {
    this.options = { ...DEFAULTS, ...options };
  }

  /**
   * Send `request` for connection `key`. Returns the response for any status the caller
   * should see (2xx, 4xx other than 429); throws `upstream_*` when the store could not
   * answer usefully after the retries allowed.
   */
  async send(key: string, url: string, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    this.enterCircuit(key);
    try {
      await this.takeToken(key);
    } catch (error) {
      // Refused before anything was sent: release a half-open trial slot, or the circuit
      // would wait forever for a trial that never ran.
      this.circuits.get(key)!.trialInFlight = false;
      throw error;
    }

    let lastError: unknown;
    for (let attempt = 1; attempt <= this.options.maxAttempts; attempt++) {
      let response: Response | null = null;
      let reached = true; // did the upstream possibly receive the request?
      try {
        response = await this.withTimeout(url, init);
      } catch (error) {
        lastError = error;
        reached = !neverSent(error);
      }

      if (response && !TRANSIENT_STATUS.has(response.status) && response.status < 500) {
        this.succeed(key);
        return response;
      }
      if (response && response.status >= 500 && !TRANSIENT_STATUS.has(response.status)) {
        // 500/501: the store answered, badly. Not transient by our rules — no retry.
        this.fail(key);
        return response;
      }

      const retryable = IDEMPOTENT.has(method) || !reached;
      if (!retryable || attempt === this.options.maxAttempts) {
        this.fail(key);
        if (response) return response;
        throw this.asUpstream(lastError);
      }
      const wait = this.delayFor(attempt, response);
      log.warn('upstream retry', { provider: this.provider, attempt, status: response?.status ?? 'network', waitMs: wait });
      await this.clock.sleep(wait);
    }
    throw this.asUpstream(lastError); // unreachable: the loop returns or throws
  }

  /** Circuit state, for the connection health badge and for tests. */
  circuitState(key: string): 'closed' | 'open' | 'half-open' {
    const circuit = this.circuits.get(key);
    if (!circuit?.openedAt) return 'closed';
    return this.clock.now() - circuit.openedAt >= this.options.cooldownMs ? 'half-open' : 'open';
  }

  // ------------------------------------------------------------------ internals

  private async withTimeout(url: string, init: RequestInit): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      return await this.fetchImpl(url, { ...init, signal: controller.signal });
    } catch (error) {
      if (controller.signal.aborted) throw new TimeoutError(`${this.provider} did not answer within ${this.options.timeoutMs} ms`);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  /** Full jitter (AWS architecture blog): random in [0, min(cap, base·2^n)]; Retry-After wins. */
  private delayFor(attempt: number, response: Response | null): number {
    const retryAfter = response?.headers.get('retry-after');
    if (retryAfter) {
      const seconds = Number(retryAfter);
      const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(retryAfter) - this.clock.now();
      if (Number.isFinite(ms) && ms >= 0) return Math.min(ms, this.options.maxDelayMs * 4);
    }
    const ceiling = Math.min(this.options.maxDelayMs, this.options.baseDelayMs * 2 ** (attempt - 1));
    return Math.floor(this.clock.random() * ceiling);
  }

  private enterCircuit(key: string): void {
    const circuit = this.circuits.get(key) ?? { failures: 0, openedAt: null, trialInFlight: false };
    this.circuits.set(key, circuit);
    const state = this.circuitState(key);
    if (state === 'open') throw errors.upstream(this.provider, new Error('circuit open'));
    if (state === 'half-open') {
      if (circuit.trialInFlight) throw errors.upstream(this.provider, new Error('circuit half-open, trial in flight'));
      circuit.trialInFlight = true;
    }
  }

  private succeed(key: string): void {
    this.circuits.set(key, { failures: 0, openedAt: null, trialInFlight: false });
  }

  private fail(key: string): void {
    const circuit = this.circuits.get(key)!;
    circuit.trialInFlight = false;
    circuit.failures += 1;
    if (circuit.openedAt !== null || circuit.failures >= this.options.failureThreshold) {
      circuit.openedAt = this.clock.now(); // (re)open: a failed trial restarts the cooldown
      log.warn('circuit open', { provider: this.provider, failures: circuit.failures });
    }
  }

  /** Token bucket. Waits for a slot if one comes within `maxQueueMs`; otherwise refuses. */
  private async takeToken(key: string): Promise<void> {
    const { requests, perMs } = this.options.rate;
    const refillPerMs = requests / perMs;
    const bucket = this.buckets.get(key) ?? { tokens: requests, updatedAt: this.clock.now() };
    this.buckets.set(key, bucket);
    const now = this.clock.now();
    bucket.tokens = Math.min(requests, bucket.tokens + (now - bucket.updatedAt) * refillPerMs);
    bucket.updatedAt = now;
    if (bucket.tokens >= 1) { bucket.tokens -= 1; return; }

    const waitMs = Math.ceil((1 - bucket.tokens) / refillPerMs);
    if (waitMs > this.options.maxQueueMs) throw errors.rateLimited(Math.ceil(waitMs / 1000));
    bucket.tokens -= 1; // reserve the slot now so concurrent callers queue behind it
    await this.clock.sleep(waitMs);
  }

  private asUpstream(error: unknown): AppError {
    if (error instanceof TimeoutError) return new AppError('upstream_timeout', { detail: error.message, cause: error });
    return errors.upstream(this.provider, error);
  }
}

export class TimeoutError extends Error {}

/**
 * Failures that happen before a single byte goes out. `fetch` throws the same
 * `TypeError('fetch failed')` for a refused connection and for one the store dropped after
 * reading the request, so only the cause's code tells them apart. Anything else — a timeout,
 * a reset, a runtime that reports errors differently — counts as possibly received: a
 * non-idempotent call is then not repeated.
 */
const NOT_SENT = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN']);

function neverSent(error: unknown): boolean {
  for (let e: unknown = error; e; e = (e as { cause?: unknown }).cause) {
    if (NOT_SENT.has(String((e as { code?: unknown }).code))) return true;
  }
  return false;
}
