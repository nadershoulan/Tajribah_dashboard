/**
 * T69 — "Sign in with Google" to pick a GA4 measurement id instead of copying it by hand: for the
 * website (staff, the admin console) and for a store's own products' pages (Store settings).
 *
 * Google's standard OAuth code flow, read-only (`analytics.readonly`), online access — no refresh
 * token is asked for and **nothing of Google's is kept**: the callback exchanges the code at once,
 * reads the person's GA4 web streams through the Analytics Admin API (account summaries, then each
 * property's data streams), and hands the list back to the page that started it in a signed,
 * ten-minute ticket. The access token is dropped there. The person then picks one; saving it is the
 * ordinary settings save, which accepts a pasted id just the same.
 *
 * The `state` is the Zid flow's (T61): a signed payload with a nonce that must match a short-lived
 * HttpOnly cookie, so a callback only completes in the browser that started it. It also says who
 * started it — staff, or one person in one store — and the ticket can be opened only by them.
 *
 * T121 — **no GA4 web stream yet: we create one.** The read-only sign-in found nothing, so the callback sends the
 * browser straight back to Google for `analytics.edit` (asked only now, only of people who need it). With it we ask
 * Google for an account ticket (`accounts:provisionAccountTicket`); the person accepts Google Analytics' terms on
 * Google's own page — the one step no one can do for them — and Google returns them to `/api/google/provisioned`.
 * There we find the new account, create its property (Riyadh time, SAR) and a web data stream, and hand back its
 * measurement id in the usual ticket. Across the terms page the access token waits in the person's own browser:
 * an encrypted, HttpOnly cookie for `/api/google` only, twenty minutes at most, cleared on return. It is never stored.
 */
import { decryptSecret, encryptSecret, keyedHash, timingSafeEqual } from '@/server/core/auth/crypto';
import { Transport } from '@/server/connectors/transport';
import { errors } from '@/server/core/errors/problem';
import { log } from '@/server/core/observability/log';
import { GA4_ID_RE, type Ga4Stream } from '@/lib/contracts/settings';

export const GOOGLE_AUTH = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
export const GA_ADMIN = 'https://analyticsadmin.googleapis.com/v1beta';
export const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
/** T121: only to create a GA4 account for someone who has none. */
export const GA4_EDIT_SCOPE = 'https://www.googleapis.com/auth/analytics.edit';
/** Google's page where the person accepts the Analytics terms for a new account. */
export const GA_TERMS = 'https://analytics.google.com/analytics/web/?provisioningSignup=false#/termsofservice/';

/** `provisionedUri` (T121): where Google returns after its terms page — also one of the OAuth client's redirect addresses. */
export type GoogleApp = { clientId: string; clientSecret: string; redirectUri: string; authSecret: string; provisionedUri?: string };
/** T121: what a new GA4 account is called, and the web address its stream measures. */
export type NewAccount = { name: string; website: string };
/** Who started the sign-in: staff for the website, or one person in one store. */
export type Ga4Purpose = { p: 'site'; u: string } | { p: 'store'; t: string; u: string };
export type { Ga4Stream };

export const GOOGLE_STATE_COOKIE = 'tajribah_google_state';
/** T121: the access token, encrypted, while the person is on Google's terms page. */
export const GOOGLE_PENDING_COOKIE = 'tajribah_google_pending';
export const PENDING_TTL_MS = 20 * 60_000;
export const STATE_TTL_MS = 10 * 60_000;
export const TICKET_TTL_MS = 10 * 60_000;
/** At most this many properties are read: a person with more pastes the id instead. */
export const MAX_PROPERTIES = 25;

/** Where each kind of sign-in returns to — the screen that started it. */
export const RETURN_TO = { site: '/admin/site', store: '/dashboard/settings' } as const;

const enc = new TextEncoder();
const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(enc.encode(a), enc.encode(b));
const b64 = (text: string) => btoa(String.fromCharCode(...enc.encode(text))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (text: string) => new TextDecoder().decode(Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0)));
const randomNonce = () => [...crypto.getRandomValues(new Uint8Array(16))].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sign(secret: string, purpose: string, body: unknown): Promise<string> {
  const payload = b64(JSON.stringify(body));
  return `${payload}.${await keyedHash(secret, purpose, payload)}`;
}

async function unsign<T>(secret: string, purpose: string, signed: string): Promise<T | null> {
  const [payload, mac] = signed.split('.');
  if (!payload || !mac || !sameText(await keyedHash(secret, purpose, payload), mac)) return null;
  try { return JSON.parse(unb64(payload)) as T; } catch { return null; }
}

/** `m`: 'create' once the read-only sign-in found nothing; `a`/`w`: the new account's name and website. */
type State = Ga4Purpose & { n: string; e: number; m?: 'create'; a?: string; w?: string };
type Pending = Ga4Purpose & { e: number; k: string; a: string; w: string };
/** Where the browser goes next, and what the handler sets on the way: keep the state cookie, or the pending one. */
export type CallbackResult = { location: string; keepState?: boolean; pending?: string };
type Ticket = Ga4Purpose & { e: number; s: Ga4Stream[] };

/** Google's consent screen, and the nonce the browser keeps in `GOOGLE_STATE_COOKIE`. */
export async function startGoogle(app: GoogleApp, purpose: Ga4Purpose, now = Date.now(),
  opts: { account?: NewAccount; create?: boolean; nonce?: string } = {}): Promise<{ authorizeUrl: string; nonce: string }> {
  const nonce = opts.nonce ?? randomNonce();
  const state = await sign(app.authSecret, 'google-state', {
    ...purpose, n: nonce, e: now + STATE_TTL_MS,
    ...(opts.create ? { m: 'create' as const } : {}),
    ...(opts.account ? { a: opts.account.name.trim().slice(0, 80), w: opts.account.website.slice(0, 200) } : {}),
  } satisfies State);
  const authorize = new URL(GOOGLE_AUTH);
  authorize.search = new URLSearchParams({
    client_id: app.clientId, redirect_uri: app.redirectUri, response_type: 'code', scope: opts.create ? GA4_EDIT_SCOPE : GA4_SCOPE,
    access_type: 'online', include_granted_scopes: 'false', prompt: opts.create ? 'consent' : 'select_account', state,
  }).toString();
  return { authorizeUrl: authorize.toString(), nonce };
}

/**
 * Google sent the person back. Where to send them next: the screen that started it, with
 * `#ga4=<ticket>` (the streams found) or `#ga4_error=<why>` — never an error page.
 * In the fragment, so the ticket never reaches a server log or a Referer.
 */
export async function completeGoogleCallback(query: URLSearchParams, nonce: string | null, app: GoogleApp,
  deps: { transport?: Transport; now?: number } = {}): Promise<CallbackResult> {
  const now = deps.now ?? Date.now();
  const state = await unsign<State>(app.authSecret, 'google-state', query.get('state') ?? '');
  const valid = state && typeof state.e === 'number' && state.e >= now && typeof state.n === 'string' && !!nonce && sameText(state.n, nonce)
    && (state.p === 'site' || state.p === 'store');
  // Forged, expired, or another browser's: where it came from is not known, so the store screen.
  if (!valid) return { location: `${RETURN_TO.store}#ga4_error=state` };
  const back = (fragment: string): CallbackResult => ({ location: `${RETURN_TO[state.p]}#${fragment}` });
  const creating = state.m === 'create';
  const wanted = creating ? GA4_EDIT_SCOPE : GA4_SCOPE;
  if (query.get('error') || !query.get('code')) return back('ga4_error=denied');

  const transport = deps.transport ?? new Transport('google', { rate: { requests: 60, perMs: 60_000 } });
  const token = await transport.send('google-oauth', GOOGLE_TOKEN, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
    body: new URLSearchParams({ grant_type: 'authorization_code', client_id: app.clientId, client_secret: app.clientSecret, redirect_uri: app.redirectUri, code: query.get('code')! }).toString(),
  }).catch(() => null);
  const granted = await token?.json().catch(() => null) as { access_token?: unknown; scope?: unknown; error?: unknown } | null;
  if (granted?.error === 'invalid_client' || granted?.error === 'unauthorized_client') {
    log.error('Google refused the app’s own keys — check GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET and the redirect address');
    return back('ga4_error=setup');
  }
  if (!token?.ok || typeof granted?.access_token !== 'string') return back(`ga4_error=${(token?.status ?? 503) >= 500 ? 'unavailable' : 'code'}`);
  // The person may untick the Analytics permission on Google's screen.
  if (typeof granted.scope === 'string' && !granted.scope.split(' ').includes(wanted)) return back('ga4_error=scope');

  let streams: Ga4Stream[];
  try {
    streams = await webStreams(granted.access_token, transport);
  } catch (error) {
    log.warn('google callback: GA4 streams could not be read', { error: error instanceof Error ? error.message : String(error) });
    return back('ga4_error=unavailable');
  }
  const purpose = purposeOf(state);
  if (streams.length) return back(`ga4=${await ticketFor(app, purpose, streams, now)}`);

  // T121: none — create one, when we know what to call it and where Google may send the person back.
  if (!app.provisionedUri || !state.a || !state.w) return back('ga4_error=none');
  if (!creating) {
    // Straight back to Google for the permission to create; the same browser nonce carries on.
    const again = await startGoogle(app, purpose, now, { create: true, nonce: state.n, account: { name: state.a, website: state.w } });
    return { location: again.authorizeUrl, keepState: true };
  }
  let ticketId: string | null = null;
  try {
    const response = await transport.send('google-analytics', `${GA_ADMIN}/accounts:provisionAccountTicket`, {
      method: 'POST',
      headers: { authorization: `Bearer ${granted.access_token}`, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ account: { displayName: state.a, regionCode: 'SA' }, redirectUri: app.provisionedUri }),
    });
    const body = await response.json().catch(() => null) as { accountTicketId?: unknown } | null;
    if (response.ok && typeof body?.accountTicketId === 'string' && /^[\w-]{1,200}$/.test(body.accountTicketId)) ticketId = body.accountTicketId;
    else log.warn('google: the account ticket was refused', { status: response.status });
  } catch (error) {
    log.warn('google: the account ticket could not be asked for', { error: error instanceof Error ? error.message : String(error) });
  }
  if (!ticketId) return back('ga4_error=create');
  const pending = await encryptSecret(JSON.stringify({ ...purpose, e: now + PENDING_TTL_MS, k: granted.access_token, a: state.a, w: state.w } satisfies Pending), app.authSecret, 'google-pending');
  return { location: `${GA_TERMS}${ticketId}`, pending };
}

function purposeOf(state: Ga4Purpose): Ga4Purpose {
  return state.p === 'site' ? { p: 'site', u: state.u } : { p: 'store', t: state.t, u: state.u };
}

const ticketFor = (app: Pick<GoogleApp, 'authSecret'>, purpose: Ga4Purpose, streams: Ga4Stream[], now: number) =>
  sign(app.authSecret, 'google-ticket', { ...purpose, e: now + TICKET_TTL_MS, s: streams } satisfies Ticket);

/**
 * T121 — Google sent the person back from its terms page. Find the account it made (ours by name, with nothing in
 * it yet), give it a property and a web data stream, and return its measurement id in a ticket. Terms not accepted,
 * or the twenty minutes ran out: a reason, on the screen that started it.
 */
export async function completeProvisioning(pendingEnvelope: string | null, app: Pick<GoogleApp, 'authSecret'>,
  deps: { transport?: Transport; now?: number } = {}): Promise<CallbackResult> {
  const now = deps.now ?? Date.now();
  const raw = pendingEnvelope ? await decryptSecret(pendingEnvelope, app.authSecret, 'google-pending') : null;
  let pending: Pending | null = null;
  try { pending = raw ? JSON.parse(raw) as Pending : null; } catch { pending = null; }
  if (!pending || typeof pending.e !== 'number' || pending.e < now || (pending.p !== 'site' && pending.p !== 'store')
    || typeof pending.k !== 'string' || typeof pending.a !== 'string' || typeof pending.w !== 'string') {
    return { location: `${RETURN_TO.store}#ga4_error=state` };
  }
  const p = pending;
  const back = (fragment: string): CallbackResult => ({ location: `${RETURN_TO[p.p]}#${fragment}` });

  const transport = deps.transport ?? new Transport('google', { rate: { requests: 60, perMs: 60_000 } });
  const headers = { authorization: `Bearer ${p.k}`, accept: 'application/json', 'content-type': 'application/json' };
  const call = async <T>(url: string, body?: unknown): Promise<T> => {
    const response = await transport.send('google-analytics', url, body === undefined ? { headers } : { method: 'POST', headers, body: JSON.stringify(body) });
    if (!response.ok) {
      await response.body?.cancel();
      throw errors.upstream('google', new Error(`${new URL(url).pathname}: ${response.status}`));
    }
    return response.json() as Promise<T>;
  };

  try {
    // The new account: called what we asked for, with no property yet — the most recent if there are several.
    let account: string | null = null;
    let page: string | undefined;
    do {
      const url = new URL(`${GA_ADMIN}/accountSummaries`);
      url.searchParams.set('pageSize', '200');
      if (page) url.searchParams.set('pageToken', page);
      const body = await call<Summaries>(url.toString());
      for (const a of body.accountSummaries ?? []) {
        if (a.displayName !== p.a || (a.propertySummaries ?? []).length || typeof a.account !== 'string' || !/^accounts\/\d{1,20}$/.test(a.account)) continue;
        if (!account || BigInt(a.account.slice(9)) > BigInt(account.slice(9))) account = a.account;
      }
      page = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : undefined;
    } while (page);
    if (!account) return back('ga4_error=tos');

    const property = await call<{ name?: string }>(`${GA_ADMIN}/properties`, {
      parent: account, displayName: p.a, timeZone: 'Asia/Riyadh', currencyCode: 'SAR', industryCategory: 'SHOPPING',
    });
    if (typeof property.name !== 'string' || !/^properties\/\d{1,20}$/.test(property.name)) throw new Error('no property name');
    const stream = await call<{ displayName?: string; webStreamData?: { measurementId?: string } }>(`${GA_ADMIN}/${property.name}/dataStreams`, {
      type: 'WEB_DATA_STREAM', displayName: p.a, webStreamData: { defaultUri: p.w },
    });
    const id = stream.webStreamData?.measurementId;
    if (typeof id !== 'string' || !GA4_ID_RE.test(id)) throw new Error('no measurement id');
    log.info('google: a GA4 account was created', { for: p.p, measurementId: id });
    const made: Ga4Stream = { measurementId: id, stream: name(stream.displayName, id), property: p.a, account: p.a, url: p.w };
    return back(`ga4=${await ticketFor(app, purposeOf(p), [made], now)}`);
  } catch (error) {
    log.warn('google: the new GA4 account could not be finished', { error: error instanceof Error ? error.message : String(error) });
    return back('ga4_error=create');
  }
}

type Summaries = { accountSummaries?: { account?: string; displayName?: string; propertySummaries?: { property?: string; displayName?: string }[] }[]; nextPageToken?: string };
type Streams = { dataStreams?: { type?: string; displayName?: string; webStreamData?: { measurementId?: string; defaultUri?: string } }[] };

const name = (v: unknown, fallback: string) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 120) : fallback);

/** Every GA4 web stream the person can read, up to `MAX_PROPERTIES` properties. */
export async function webStreams(accessToken: string, transport: Transport): Promise<Ga4Stream[]> {
  const headers = { authorization: `Bearer ${accessToken}`, accept: 'application/json' };
  const read = async <T>(url: string): Promise<T> => {
    const response = await transport.send('google-analytics', url, { headers });
    if (!response.ok) {
      await response.body?.cancel();
      throw errors.upstream('google', new Error(`${new URL(url).pathname}: ${response.status}`));
    }
    return response.json() as Promise<T>;
  };
  const properties: { property: string; propertyName: string; accountName: string }[] = [];
  let page: string | undefined;
  do {
    const url = new URL(`${GA_ADMIN}/accountSummaries`);
    url.searchParams.set('pageSize', '50');
    if (page) url.searchParams.set('pageToken', page);
    const body = await read<Summaries>(url.toString());
    for (const account of body.accountSummaries ?? []) {
      for (const p of account.propertySummaries ?? []) {
        if (typeof p.property === 'string' && /^properties\/\d{1,20}$/.test(p.property)) {
          properties.push({ property: p.property, propertyName: name(p.displayName, p.property), accountName: name(account.displayName, '') });
        }
      }
    }
    page = typeof body.nextPageToken === 'string' && body.nextPageToken ? body.nextPageToken : undefined;
  } while (page && properties.length < MAX_PROPERTIES);

  const out: Ga4Stream[] = [];
  for (const p of properties.slice(0, MAX_PROPERTIES)) {
    const body = await read<Streams>(`${GA_ADMIN}/${p.property}/dataStreams?pageSize=50`);
    for (const s of body.dataStreams ?? []) {
      const id = s.webStreamData?.measurementId;
      if (s.type !== 'WEB_DATA_STREAM' || typeof id !== 'string' || !GA4_ID_RE.test(id)) continue;
      const uri = s.webStreamData?.defaultUri;
      out.push({ measurementId: id, stream: name(s.displayName, id), property: p.propertyName, account: p.accountName, url: typeof uri === 'string' && /^https?:\/\//.test(uri) ? uri.slice(0, 200) : null });
    }
  }
  return out;
}

/** The streams a ticket carries — only for the person (and store) who started the sign-in, and only for ten minutes. */
export async function openTicket(app: Pick<GoogleApp, 'authSecret'>, ticket: string, who: Ga4Purpose, now = Date.now()): Promise<Ga4Stream[]> {
  const t = await unsign<Ticket>(app.authSecret, 'google-ticket', ticket);
  const mine = t && t.p === who.p && t.u === who.u && (who.p === 'site' || (t.p === 'store' && t.t === who.t));
  if (!t || !mine || typeof t.e !== 'number' || t.e < now || !Array.isArray(t.s)) {
    const why = 'this Google sign-in has expired or is not yours — sign in again';
    throw errors.validation({ ticket: [why] }, why);
  }
  return t.s;
}
