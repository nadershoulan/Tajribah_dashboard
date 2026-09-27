/**
 * P4.1 — the browser SDK: batch events, send them once, never get in the shop's way.
 *
 * Rules, in the order they matter:
 *  - **It cannot break the page.** Every entry point is wrapped; a failed send is dropped, not
 *    retried in a loop, and nothing ever throws into the merchant's code.
 *  - **It sends nothing before it may.** Do Not Track / Global Privacy Control, or a merchant
 *    who set consent to required and has not granted it, means events are discarded at the
 *    door — not queued for later, which would be the same data arriving late.
 *  - **It sends what `events.ts` allows and nothing else** (§7.10: no IP, no user agent, no
 *    cross-site identifier, no identity). What the collector learns beyond that — country,
 *    device family — it derives at the edge from the request it is already receiving (P4.2).
 *  - **It leaves with the page.** `sendBeacon` on `pagehide`/`visibilitychange`, because a
 *    shopper who converts closes the tab, and `fetch` from an unloading page is not delivered.
 *
 * The core takes its world as arguments so it can be tested without a browser: `now`, the
 * beacon, the fetch, the session store and the privacy signals are all injected.
 */
import { EVENT_SCHEMA_VERSION, LIMITS, sanitize, type EventBatch, type TrackInput, type WireEvent } from './events';

export type Consent = 'granted' | 'required';

export type TrackerEnv = {
  /** Where batches go. The collector (P4.2); no default host is assumed by the core. */
  endpoint: string;
  /** The merchant's public store key. */
  store: string;
  sdk: string;
  now: () => number;
  /** Returns true when the browser accepted the payload for sending. */
  beacon?: (url: string, body: Blob | string) => boolean;
  fetchImpl?: typeof fetch;
  /** One tab session's token; see `sessionToken`. */
  session: string;
  /** True when the visitor has asked not to be tracked (DNT or GPC). */
  doNotTrack?: boolean;
  /** `required` until the merchant's banner says otherwise. */
  consent?: Consent;
  /** Called after a flush attempt, for the tests and for nothing else. */
  onSend?: (batch: EventBatch, delivered: boolean) => void;
};

export type Tracker = {
  track: (input: TrackInput) => void;
  flush: () => boolean;
  /** The merchant's consent banner calls this; queued events are *not* back-filled. */
  setConsent: (consent: Consent) => void;
  /** Queue length. For tests. */
  pending: () => number;
  /** Events refused since boot (privacy signals, unknown types, caps). For tests and support. */
  dropped: () => number;
};

/**
 * A random token for this tab session, kept in `sessionStorage` so it dies with the tab.
 * Never a cookie and never `localStorage`: neither would survive its purpose, both would
 * outlive it. Falls back to a memory-only value when storage is unavailable (private mode),
 * which is fine — a token that is forgotten sooner is never a problem.
 */
export function sessionToken(storage: Storage | undefined, random: () => string): string {
  const key = 'tj_s';
  try {
    const found = storage?.getItem(key);
    if (found && /^[A-Za-z0-9_-]{16,64}$/.test(found)) return found;
  } catch { /* blocked storage: make a fresh one */ }
  const made = random();
  try { storage?.setItem(key, made); } catch { /* not stored: this tab still sends one token */ }
  return made;
}

/** 128 bits, base64url, from the platform's CSPRNG. */
export function randomToken(crypto?: Pick<Crypto, 'getRandomValues'>): string {
  const bytes = new Uint8Array(16);
  if (crypto?.getRandomValues) crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i += 1) bytes[i] = Math.floor(Math.random() * 256);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** True when the browser or the visitor has signalled no tracking. */
export function privacySignal(nav: Partial<Navigator> & { globalPrivacyControl?: boolean }, win?: { doNotTrack?: string | null }): boolean {
  const dnt = (nav as { doNotTrack?: string | null }).doNotTrack ?? win?.doNotTrack;
  return dnt === '1' || dnt === 'yes' || nav.globalPrivacyControl === true;
}

export function createTracker(env: TrackerEnv): Tracker {
  const queue: WireEvent[] = [];
  // Even building a tracker must not throw into the shop: a page that has replaced Date.now
  // (they exist) gets a tracker whose first batch has odd offsets, not a broken product page.
  let openedAt = 0;
  try { openedAt = env.now(); } catch { /* left at 0 */ }
  let consent: Consent = env.consent ?? 'granted';
  let dropped = 0;

  const allowed = () => !env.doNotTrack && consent === 'granted';

  const send = (batch: EventBatch): boolean => {
    const body = JSON.stringify(batch);
    // Over the cap means a bug upstream, not a batch to split: drop it and say so in tests.
    if (body.length > LIMITS.bodyBytes) return false;
    let delivered = false;
    try {
      if (env.beacon) {
        // A typed Blob, so the collector reads JSON and the request stays a simple CORS POST.
        const blob = typeof Blob === 'function' ? new Blob([body], { type: 'application/json' }) : body;
        delivered = env.beacon(env.endpoint, blob) === true;
      }
      if (!delivered && env.fetchImpl) {
        // `keepalive` is the only thing that survives an unloading page without a beacon.
        void env.fetchImpl(env.endpoint, {
          method: 'POST', body, keepalive: true, mode: 'cors', credentials: 'omit',
          headers: { 'content-type': 'application/json' },
        }).catch(() => undefined);
        delivered = true;
      }
    } catch {
      delivered = false;
    }
    try { env.onSend?.(batch, delivered); } catch { /* a test's callback is not our problem */ }
    return delivered;
  };

  const flush = (): boolean => {
    try {
      if (queue.length === 0) return false;
      // Taken before the send, and not put back if it fails: one attempt, then gone.
      const events = queue.splice(0, queue.length);
      openedAt = env.now();
      return send({ v: EVENT_SCHEMA_VERSION, store: env.store, session: env.session, sdk: env.sdk, sentAt: env.now(), events });
    } catch {
      return false;
    }
  };

  const track = (input: TrackInput): void => {
    try {
      if (!allowed()) { dropped += 1; return; }
      const event = sanitize(input, env.now() - openedAt);
      if (!event) { dropped += 1; return; }
      queue.push(event);
      // The queue cannot grow past a batch: reaching that size empties it, and a send that
      // fails empties it too (below). A shopper's analytics are not worth retrying into a loop
      // inside someone else's shop.
      if (queue.length >= LIMITS.batch) flush();
    } catch {
      dropped += 1;
    }
  };

  return {
    track,
    flush,
    setConsent: (next) => { consent = next; },
    pending: () => queue.length,
    dropped: () => dropped,
  };
}
