/**
 * T62 — asking the edge to serve a store's own address: Cloudflare for SaaS custom hostnames, from
 * Cloudflare's public API documentation (read 2026-10-01); the real account confirms it.
 *
 *  - `POST /zones/{zone}/custom_hostnames { hostname, ssl: { method: 'http', type: 'dv' } }` → 201
 *    with the hostname's id; the certificate is validated over HTTP through the CNAME the store
 *    already added, so the merchant adds nothing more.
 *  - It is **serving** when the hostname's `status` and its certificate's (`ssl.status`) are both
 *    `active`. Until then Cloudflare says what it is waiting for (`verification_errors`,
 *    `ssl.validation_errors`).
 *  - A hostname asked for twice answers 409: it is looked up by name and its id reused, so a lost
 *    answer never leaves two.
 *  - A hostname that is gone answers 404 (`get` → null). Our own token refused (400 with code 9106 —
 *    the real API's answer, checked 2026-10-01 — or 401/403) is a setup fault: an upstream error,
 *    logged, never a reason to change a store's address.
 */
import type { Env } from '@/server/core/config/env';
import { errors } from '@/server/core/errors/problem';
import { log } from '@/server/core/observability/log';

export const CLOUDFLARE_API = 'https://api.cloudflare.com/client/v4';

export type HostnameState = { id: string; active: boolean; waitingFor: string | null };

export interface CustomHostnames {
  /** Ask for `hostname` to be served (or find the one already asked for). */
  ensure(hostname: string): Promise<HostnameState>;
  /** Where it stands; null when it no longer exists. */
  get(id: string): Promise<HostnameState | null>;
  /** Stop serving it. A hostname already gone is fine. */
  remove(id: string): Promise<void>;
}

type CfHostname = {
  id?: string; hostname?: string; status?: string; verification_errors?: string[];
  ssl?: { status?: string; validation_errors?: { message?: string }[] } | null;
};
type CfAnswer<T> = { success?: boolean; errors?: { code?: number; message?: string }[]; result?: T | null };

function stateOf(h: CfHostname): HostnameState {
  if (!h.id) throw errors.upstream('cloudflare', new Error('custom hostname: no id in the answer'));
  const active = h.status === 'active' && h.ssl?.status === 'active';
  const waitingFor = active ? null
    : h.verification_errors?.[0] ?? h.ssl?.validation_errors?.[0]?.message ?? `hostname ${h.status ?? 'unknown'}, certificate ${h.ssl?.status ?? 'unknown'}`;
  return { id: h.id, active, waitingFor };
}

export class CloudflareCustomHostnames implements CustomHostnames {
  constructor(private readonly zoneId: string, private readonly token: string, private readonly fetcher: typeof fetch = fetch) {}

  private async call<T>(method: string, path: string, body?: unknown): Promise<{ status: number; answer: CfAnswer<T> | null }> {
    let response: Response;
    try {
      response = await this.fetcher(`${CLOUDFLARE_API}/zones/${this.zoneId}/custom_hostnames${path}`, {
        method, headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      throw errors.upstream('cloudflare', error);
    }
    const answer = await response.json().catch(() => null) as CfAnswer<T> | null;
    const codes = (answer?.errors ?? []).map((e) => e.code);
    if (response.status === 401 || response.status === 403 || codes.includes(9106) || codes.includes(10000)) {
      log.error('Cloudflare refused the custom-hostname token — check CLOUDFLARE_SAAS_API_TOKEN and CLOUDFLARE_SAAS_ZONE_ID');
      throw errors.upstream('cloudflare', new Error('custom hostnames: the API token was refused'));
    }
    if (response.status >= 500 || response.status === 429) throw errors.upstream('cloudflare', new Error(`custom hostnames: ${response.status}`));
    return { status: response.status, answer };
  }

  async ensure(hostname: string): Promise<HostnameState> {
    const made = await this.call<CfHostname>('POST', '', { hostname, ssl: { method: 'http', type: 'dv' } });
    if (made.answer?.success && made.answer.result) return stateOf(made.answer.result);
    if (made.status === 409) {
      const found = await this.call<CfHostname[]>('GET', `?hostname=${encodeURIComponent(hostname)}`);
      const same = (found.answer?.result ?? []).find((h) => h.hostname === hostname);
      if (same) return stateOf(same);
    }
    throw errors.upstream('cloudflare', new Error(`custom hostname not made (${made.status}): ${(made.answer?.errors ?? []).map((e) => `${e.code} ${e.message}`).join('; ').slice(0, 200)}`));
  }

  async get(id: string): Promise<HostnameState | null> {
    const { status, answer } = await this.call<CfHostname>('GET', `/${encodeURIComponent(id)}`);
    if (status === 404) return null;
    if (!answer?.success || !answer.result) throw errors.upstream('cloudflare', new Error(`custom hostname not read (${status})`));
    return stateOf(answer.result);
  }

  async remove(id: string): Promise<void> {
    const { status, answer } = await this.call<unknown>('DELETE', `/${encodeURIComponent(id)}`);
    if (status === 404 || answer?.success) return;
    throw errors.upstream('cloudflare', new Error(`custom hostname not removed (${status})`));
  }
}

let current: CustomHostnames | null = null;

/** The edge that serves stores' addresses, or null until Tajribah's Cloudflare zone is set (T62). */
export function customHostnames(): CustomHostnames | null {
  return current;
}

export function setCustomHostnames(adapter: CustomHostnames | null): void {
  current = adapter;
}

export function configureCustomHostnames(env: Pick<Env, 'CLOUDFLARE_SAAS_ZONE_ID' | 'CLOUDFLARE_SAAS_API_TOKEN'>): void {
  current = env.CLOUDFLARE_SAAS_ZONE_ID && env.CLOUDFLARE_SAAS_API_TOKEN
    ? new CloudflareCustomHostnames(env.CLOUDFLARE_SAAS_ZONE_ID, env.CLOUDFLARE_SAAS_API_TOKEN)
    : null;
}
